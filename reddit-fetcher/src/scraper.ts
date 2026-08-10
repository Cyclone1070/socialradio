import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { FingerprintGenerator } from 'fingerprint-generator';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { z } from 'zod';
import type { RedditCommentData, RedditPostData } from './types';

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
    after: z.string().nullish(),
    children: z.array(ListingChildSchema),
  }),
});

// Recursive comment node for deeply nested replies
interface InternalCommentNode {
  kind: string;
  data: {
    id: string;
    body: string;
    author: string;
    score: number;
    parent_id: string;
    created_utc: number;
    replies?: { data: { children: InternalCommentNode[] } } | string;
  };
}

const CommentChildSchema: z.ZodType<InternalCommentNode> = z.lazy(() =>
  z.object({
    kind: z.string(),
    data: z.object({
      id: z.string(),
      body: z.string(),
      author: z.string(),
      score: z.number(),
      parent_id: z.string(),
      created_utc: z.number(),
      replies: z
        .object({
          data: z.object({
            children: z.array(CommentChildSchema),
          }),
        })
        .or(z.string())
        .optional(),
    }),
  }),
);

const CommentResponseSchema = z.object({
  data: z.object({
    children: z.array(CommentChildSchema),
  }),
});

// Context affinity: a subreddit keeps one browser context (its "identity":
// fingerprint, cookies) for every request about that sub. Idle contexts are
// closed after CONTEXT_IDLE_MS and evicted.
const CONTEXT_IDLE_MS = 15 * 60 * 1000;

export class RedditScraper {
  private readonly fingerprintGenerator = new FingerprintGenerator();
  private browser: Browser | null = null;
  private readonly contexts = new Map<string, BrowserContext>();
  private readonly lastUsedAt = new Map<string, number>();

  constructor(private readonly wsEndpoint: string) {
    // Register the canon stealth plugin
    chromium.use(StealthPlugin());
  }

  private async connect(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.connect(this.wsEndpoint);
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
      console.error(
        '[scraper] browser session died, reconnecting and retrying',
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
      await page.close();
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

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // The feed JSON is the source of truth — no shreddit-post selector
      // wait (a leftover from the DOM-scraping era that cost 2.5–15s per
      // request). A 404 = truly dead; 403/429/network blips get a bounded
      // retry inside the page before we give up and report isInvalid.
      // t=week is the 7-day scrape window; after=<cursor> walks the pool.
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
        // A page with no viable posts is a stop signal — the walk would
        // only meet more of the same. Collapse the cursor even if the
        // listing says the pool continues.
        after: posts.length > 0 ? (listing.data.after ?? null) : null,
        isInvalid: false,
      };
    });
  }

  async exists(subredditName: string): Promise<boolean> {
    return this.withRetryOnDeadBrowser(subredditName, async (page) => {
      const url = `https://www.reddit.com/r/${subredditName}/`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      try {
        // Wait for all dynamic fetches to settle
        await page.waitForLoadState('networkidle', { timeout: 8000 });
      } catch {
        // Ignore networkidle timeouts to verify what loaded
      }

      const postCount = await page.evaluate(
        () => document.querySelectorAll('shreddit-post').length,
      );
      return postCount > 0;
    });
  }

  async fetchPostComments(
    subredditName: string,
    postRedditId: string,
  ): Promise<RedditCommentData[]> {
    return this.withRetryOnDeadBrowser(subredditName, async (page) => {
      const url = `https://www.reddit.com/r/${subredditName}/comments/${postRedditId}/`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // sort=top: highest-scored comments first; limit=250: enough comments
      // to clear the 2500-word guard (measured sweet spot — 500 pulled a
      // 1.2MB payload for zero extra yield); showmore=false: drops "more"
      // placeholder nodes that break CommentChildSchema (undocumented param
      // — tolerant schema is the fallback).
      const commentsUrl = './.json?sort=top&limit=250&showmore=false';
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
