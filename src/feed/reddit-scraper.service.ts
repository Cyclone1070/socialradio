import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { FingerprintGenerator } from 'fingerprint-generator';

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

      const rawJson = await page.evaluate(async (feedLimit) => {
        const res = await fetch(`./.json?limit=${feedLimit}`);
        if (!res.ok) {
          throw new Error(`Failed to fetch subreddit feed JSON: ${res.status}`);
        }
        return res.json();
      }, limit);

      const children = rawJson?.data?.children || [];
      const posts: RedditPostData[] = children
        .filter((child: any) => {
          const d = child.data;
          return d && Number(d.num_comments) >= 40;
        })
        .map((child: any) => {
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

      const rawJson = await page.evaluate(async () => {
        const res = await fetch('./.json');
        if (!res.ok) {
          throw new Error(`Failed to fetch comments JSON: ${res.status}`);
        }
        return res.json();
      });

      const flattenComments = (children: any[]): RedditCommentData[] => {
        const results: RedditCommentData[] = [];
        if (!children) return results;

        for (const child of children) {
          if (child.kind !== 't1') continue;
          const d = child.data;
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

          if (d.replies && d.replies.data && d.replies.data.children) {
            results.push(...flattenComments(d.replies.data.children));
          }
        }
        return results;
      };

      const flattened = flattenComments(rawJson[1]?.data?.children || []);
      return flattened;
    } finally {
      await page.close();
      await context.close();
      await browser.close();
    }
  }
}


