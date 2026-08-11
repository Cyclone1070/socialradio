import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { FingerprintGenerator } from 'fingerprint-generator';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { z } from 'zod';
import type { RedditCommentData, RedditPostData } from './types';
import pino from 'pino';

// ── Zod schemas for Reddit JSON API ──────────────────────────────────
const ListingChildDataSchema = z.object({
  id: z.string(),
  title: z.string(),
  selftext: z.string(),
  author: z.string(),
  score: z.number(),
  num_comments: z.number(),
  created_utc: z.number(),
});

const ListingChildSchema = z.object({
  kind: z.string(),
  data: ListingChildDataSchema,
});

const ListingResponseSchema = z.object({
  data: z.object({
    after: z.string().nullable(),
    children: z.array(ListingChildSchema),
  }),
});

const InternalCommentNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    kind: z.string(),
    data: z.object({
      id: z.string().optional(),
      body: z.string().optional(),
      author: z.string().optional(),
      score: z.number().optional(),
      parent_id: z.string().optional(),
      created_utc: z.number().optional(),
      replies: z
        .union([
          z.object({
            data: z.object({
              children: z.array(InternalCommentNodeSchema).optional(),
            }),
          }),
          z.string(),
        ])
        .optional(),
    }),
  }),
);

type InternalCommentNode = {
  kind: string;
  data: {
    id?: string;
    body?: string;
    author?: string;
    score?: number;
    parent_id?: string;
    created_utc?: number;
    replies?: { data: { children?: InternalCommentNode[] } } | string;
  };
};

const CommentResponseSchema = z.object({
  data: z.object({
    children: z.array(
      InternalCommentNodeSchema as z.ZodType<InternalCommentNode>,
    ),
  }),
});

// Cache eviction TTL: idle per-subreddit contexts closed after 10 minutes
const CONTEXT_IDLE_MS = 10 * 60 * 1000;

export class RedditScraper {
  private browser: Browser | null = null;
  private readonly fingerprintGenerator = new FingerprintGenerator();
  private readonly contexts = new Map<string, BrowserContext>();
  private readonly lastUsedAt = new Map<string, number>();

  constructor(
    private readonly wsEndpoint: string,
    private readonly logger: pino.Logger = pino({
      level: process.env.LOG_LEVEL ?? 'info',
    }),
  ) {
    // Register the canon stealth plugin
    chromium.use(StealthPlugin());
  }

  private async connect(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.connect(this.wsEndpoint);
      this.logger.info({}, 'browser connected');
    }
    return this.browser;
  }

  private getFingerprintContextOptions() {
    const { fingerprint } = this.fingerprintGenerator.getFingerprint({
      browsers: ['chrome'],
      devices: ['desktop'],
      operatingSystems: ['macos'],
    });

    return {
      userAgent: fingerprint.navigator.userAgent,
      viewport: {
        width: fingerprint.screen.width,
        height: fingerprint.screen.height,
      },
      locale: fingerprint.navigator.language,
    };
  }

  /** Context affinity: same subreddit → same context; different sub → fresh. */
  private async getContext(subredditName: string): Promise<BrowserContext> {
    const existing = this.contexts.get(subredditName);
    if (existing) {
      this.lastUsedAt.set(subredditName, Date.now());
      return existing;
    }

    const now = Date.now();
    for (const [sub, context] of this.contexts) {
      const lastUsed = this.lastUsedAt.get(sub) ?? 0;
      if (now - lastUsed > CONTEXT_IDLE_MS) {
        this.logger.debug({ subreddit: sub }, 'idle context evicted');
        await context.close().catch(() => {});
        this.contexts.delete(sub);
        this.lastUsedAt.delete(sub);
      }
    }

    const browser = await this.connect();
    const context = await browser.newContext(
      this.getFingerprintContextOptions(),
    );
    this.contexts.set(subredditName, context);
    this.lastUsedAt.set(subredditName, now);
    return context;
  }

  /**
   * Runs an operation, retrying ONCE after reconnecting when the browser
   * session was killed out from under us (browserless job timeouts close the
   * WebSocket; a persistent connection then holds only dead references).
   * Non-connection failures propagate unchanged.
   */
  private async withRetryOnDeadBrowser<T>(
    subredditName: string,
    fn: (page: Page) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.withPage(subredditName, fn);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/closed|connection/i.test(message)) throw err;
      this.logger.warn(
        { subreddit: subredditName },
        'browser session died, reconnecting and retrying',
      );
      await this.invalidateConnection();
      return this.withPage(subredditName, fn);
    }
  }

  /** Drop the dead browser + all contexts so the next op reconnects fresh. */
  private async invalidateConnection(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
    }
    this.browser = null;
    await Promise.all(
      [...this.contexts.values()].map((c) => c.close().catch(() => {})),
    );
    this.contexts.clear();
    this.lastUsedAt.clear();
    this.logger.info({}, 'browser connection invalidated');
  }

  private async withPage<T>(
    subredditName: string,
    fn: (page: Page) => Promise<T>,
  ): Promise<T> {
    const context = await this.getContext(subredditName);
    const page = await context.newPage();
    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => {});
    }
  }

  /**
   * Reddit's SPA reloads the document right after domcontentloaded (redirect
   * chains, param normalization), which destroys an in-flight evaluate
   * context. Retry the whole evaluate after the navigation settles;
   * connection-killed errors still bubble up to withRetryOnDeadBrowser,
   * which reconnects the browser and retries the operation once.
   */
  private async evaluateSafely<T>(
    page: Page,
    fn: (arg: any) => unknown,
    arg?: unknown,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await page.evaluate(fn as never, arg);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/closed|connection/i.test(message)) {
          throw error; // let withRetryOnDeadBrowser reconnect the browser
        }
        lastError = error;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  async fetchTopPosts(
    subredditName: string,
    opts: { limit?: number; after?: string } = {},
  ): Promise<{
    posts: RedditPostData[];
    after: string | null;
    isInvalid: boolean;
  }> {
    return this.withRetryOnDeadBrowser(subredditName, async (page) => {
      const url = `https://www.reddit.com/r/${subredditName}/`;

      const startMs = Date.now();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      this.logger.debug(
        { subreddit: subredditName, ms: Date.now() - startMs },
        'page loaded',
      );

      const limit = opts.limit ?? 100;
      const feedUrl = `./.json?limit=${limit}&t=week${opts.after ? `&after=${opts.after}` : ''}`;
      const result = await this.evaluateSafely<{ ok: boolean; json?: unknown }>(
        page,
        async (pageUrl: string): Promise<{ ok: boolean; json?: unknown }> => {
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const res = await fetch(pageUrl);
              if (res.ok) return { ok: true, json: await res.json() };
              if (res.status === 404) return { ok: false };
            } catch {
              // transient network/parse blips — retry
            }
            await new Promise((r) => setTimeout(r, 750 * (attempt + 1)));
          }
          return { ok: false };
        },
        feedUrl,
      );

      if (!result.ok) {
        return { posts: [], after: null, isInvalid: true };
      }

      const listing = ListingResponseSchema.parse(result.json);
      const children = listing.data.children || [];
      const posts: RedditPostData[] = children
        .filter((child) => {
          const d = child.data;
          return d && Number(d.num_comments) >= 40;
        })
        .map((child) => {
          const d = child.data;
          return {
            id: d.id || '',
            title: d.title || '',
            selftext: d.selftext || '',
            author: d.author || '',
            score: Number(d.score) || 0,
            created_utc: Number(d.created_utc) || 0,
          };
        });

      return {
        posts: posts.slice(0, limit),
        after: posts.length > 0 ? (listing.data.after ?? null) : null,
        isInvalid: false,
      };
    });
  }

  async exists(subredditName: string): Promise<boolean> {
    return this.withRetryOnDeadBrowser(subredditName, async (page) => {
      const url = `https://www.reddit.com/r/${subredditName}/`;
      const startMs = Date.now();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      this.logger.debug(
        { subreddit: subredditName, ms: Date.now() - startMs },
        'exists page loaded',
      );

      const feedUrl = './.json?limit=1';
      const valid = await this.evaluateSafely<boolean>(
        page,
        async (pageUrl: string): Promise<boolean> => {
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const res = await fetch(pageUrl);
              if (res.ok) {
                const json = (await res.json()) as {
                  data?: { children?: unknown[] };
                };
                return (
                  Array.isArray(json?.data?.children) &&
                  json.data.children.length > 0
                );
              }
              if (res.status === 404) return false;
            } catch {
              // retry on transient error
            }
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          }
          return false;
        },
        feedUrl,
      ).catch(() => false);

      this.logger.info(
        { subreddit: subredditName, valid },
        'subreddit exists check',
      );
      return valid;
    });
  }

  async fetchPostComments(
    subredditName: string,
    postRedditId: string,
  ): Promise<RedditCommentData[]> {
    return this.withRetryOnDeadBrowser(subredditName, async (page) => {
      const url = `https://www.reddit.com/r/${subredditName}/comments/${postRedditId}/`;
      const startMs = Date.now();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      this.logger.debug(
        { subreddit: subredditName, ms: Date.now() - startMs },
        'page loaded',
      );

      const commentsUrl = './.json?sort=top&limit=500&showmore=false';
      const rawJson = await this.evaluateSafely<unknown>(
        page,
        async (commentsPageUrl: string): Promise<unknown> => {
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const res = await fetch(commentsPageUrl);
              if (res.ok) return await res.json();
            } catch {
              // transient 403/429/network blips — retry
            }
            await new Promise((r) => setTimeout(r, 750 * (attempt + 1)));
          }
          throw new Error('Failed to fetch comments JSON');
        },
        commentsUrl,
      );

      const parsed = z.tuple([z.any(), CommentResponseSchema]).parse(rawJson);
      const commentsListing = parsed[1];

      const flattenComments = (
        children: InternalCommentNode[] | undefined,
      ): RedditCommentData[] => {
        const results: RedditCommentData[] = [];
        if (!children) return results;

        for (const child of children) {
          if (child.kind !== 't1') continue;
          const d: InternalCommentNode['data'] = child.data;
          if (!d) continue;

          // Strip prefixes for standard IDs
          const cleanId = (d.id || '').replace(/^t1_|^t3_/, '');
          const cleanParentId = (d.parent_id || '').replace(/^t1_|^t3_/, '');

          results.push({
            id: cleanId,
            body: (d.body || '').trim(),
            author: d.author || '',
            score: Number(d.score) || 0,
            parent_id: cleanParentId,
            created_utc: Number(d.created_utc) || 0,
          });

          if (
            d.replies &&
            typeof d.replies === 'object' &&
            d.replies.data?.children
          ) {
            results.push(...flattenComments(d.replies.data.children));
          }
        }
        return results;
      };

      return flattenComments(commentsListing.data.children);
    });
  }
}
