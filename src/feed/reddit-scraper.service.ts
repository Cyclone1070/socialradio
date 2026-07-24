import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { FingerprintGenerator } from 'fingerprint-generator';
import { z } from 'zod';

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

// ── Public types ─────────────────────────────────────────────────────

export interface RedditPostData {
  id: string;
  title: string;
  selftext?: string;
  author: string;
  score: number;
  created_utc: number;
}

export interface RedditCommentData {
  id: string;
  body: string;
  author: string;
  score: number;
  parent_id: string;
  created_utc: number;
}

@Injectable()
export class RedditScraperService {
  private readonly fingerprintGenerator = new FingerprintGenerator();

  constructor(private readonly configService: ConfigService) {
    // Register the canon stealth plugin
    chromium.use(StealthPlugin());
  }

  private async connect() {
    const wsEndpoint = this.configService.get<string>('BROWSERLESS_WS_URL');
    if (!wsEndpoint) {
      throw new Error('BROWSERLESS_WS_URL is not configured');
    }
    return chromium.connect(wsEndpoint);
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

  async fetchTopPosts(
    subredditName: string,
    limit: number,
  ): Promise<RedditPostData[]> {
    const browser = await this.connect();
    const contextOptions = this.getFingerprintContextOptions();
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    try {
      const url = `https://www.reddit.com/r/${subredditName}/`;

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('shreddit-post', { timeout: 15000 });

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

      return posts.slice(0, limit);
    } finally {
      await page.close();
      await context.close();
      await browser.close();
    }
  }

  async exists(subredditName: string): Promise<boolean> {
    const browser = await this.connect();
    const contextOptions = this.getFingerprintContextOptions();
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    try {
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
    } finally {
      await page.close();
      await context.close();
      await browser.close();
    }
  }

  async fetchPostComments(
    subredditName: string,
    postRedditId: string,
  ): Promise<RedditCommentData[]> {
    // Randomized throttle delay of 1.5s to 2.0s between requests to mimic human browsing
    const delayMs = Math.floor(Math.random() * 500) + 1500;
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    const browser = await this.connect();
    const contextOptions = this.getFingerprintContextOptions();
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    try {
      const url = `https://www.reddit.com/r/${subredditName}/comments/${postRedditId}/`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('shreddit-post', { timeout: 15000 });

      const rawJson: unknown = await page.evaluate(
        async (): Promise<unknown> => {
          const res = await fetch('./.json');
          if (!res.ok) {
            throw new Error(`Failed to fetch comments JSON: ${res.status}`);
          }
          return res.json();
        },
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

      const flattened = flattenComments(commentsListing.data.children);
      return flattened;
    } finally {
      await page.close();
      await context.close();
      await browser.close();
    }
  }
}
