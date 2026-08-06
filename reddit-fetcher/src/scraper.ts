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
      console.error('[scraper] browser session died, reconnecting and retrying');
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

  async fetchTopPosts(
    subredditName: string,
    limit: number,
  ): Promise<{ posts: RedditPostData[]; isInvalid: boolean }> {
    return this.withRetryOnDeadBrowser(subredditName, async (page) => {
      const url = `https://www.reddit.com/r/${subredditName}/`;

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      try {
        await page.waitForSelector('shreddit-post', { timeout: 15000 });
      } catch {
        // Page loaded but has no posts: private, banned, or non-existent
        return { posts: [], isInvalid: true };
      }

      const rawJson: unknown = await page.evaluate(
        async (feedLimit): Promise<unknown> => {
          const res = await fetch(`./.json?limit=${feedLimit}`);
          if (!res.ok) {
            throw new Error(
              `Failed to fetch subreddit feed JSON: ${res.status}`,
            );
          }
          return res.json();
        },
        limit,
      );

      const listing = ListingResponseSchema.parse(rawJson);
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

      return { posts: posts.slice(0, limit), isInvalid: false };
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
      await page.waitForSelector('shreddit-post', { timeout: 15000 });

      // sort=top: highest-scored comments first; limit=500: max batch Reddit
      // serves; showmore=false: drops "more" placeholder nodes that break
      // CommentChildSchema (undocumented param — tolerant schema is the fallback)
      const commentsUrl = './.json?sort=top&limit=500&showmore=false';
      const rawJson: unknown = await page.evaluate(
        async (commentsPageUrl): Promise<unknown> => {
          const res = await fetch(commentsPageUrl);
          if (!res.ok) {
            throw new Error(`Failed to fetch comments JSON: ${res.status}`);
          }
          return res.json();
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
