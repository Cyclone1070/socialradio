import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';
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
  private adblocker: PlaywrightBlocker | null = null;

  constructor(private readonly configService: ConfigService) {
    // Register the canon stealth plugin
    chromium.use(StealthPlugin());
  }

  private async getAdblocker(): Promise<PlaywrightBlocker> {
    if (!this.adblocker) {
      // Load standard prebuilt blocklist (contains EasyList/EasyPrivacy rules similar to uBlock Origin)
      this.adblocker =
        await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch);
    }
    return this.adblocker;
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

    // Enable uBlock-equivalent network blocking on page
    const blocker = await this.getAdblocker();
    await blocker.enableBlockingInPage(page);

    try {
      const url = `https://www.reddit.com/r/${subredditName}/`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('shreddit-post', { timeout: 15000 });

      const rawPosts = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('shreddit-post'))
          .map((el) => {
            const rawId = el.getAttribute('id') || '';
            const scoreAttr = el.getAttribute('score') || '0';
            const timestampAttr = el.getAttribute('created-timestamp') || '';

            let createdUtc = 0;
            if (timestampAttr) {
              createdUtc = Math.floor(Date.parse(timestampAttr) / 1000);
            }

            // Strip t3_ prefix
            const cleanId = rawId.replace('t3_', '');

            // Check if it's an ad post
            const isAd =
              el.hasAttribute('is-ad') || el.getAttribute('is-ad') === 'true';

            return {
              id: cleanId,
              title: el.getAttribute('post-title') || '',
              selftext: '',
              author: el.getAttribute('author') || '',
              score: parseInt(scoreAttr, 10),
              created_utc: createdUtc,
              isAd,
            };
          })
          .filter((p) => p.title !== '' && !p.isAd)
          .map((p) => ({
            id: p.id,
            title: p.title,
            selftext: p.selftext,
            author: p.author,
            score: p.score,
            created_utc: p.created_utc,
          }));
      });

      return rawPosts.slice(0, limit);
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

    const blocker = await this.getAdblocker();
    await blocker.enableBlockingInPage(page);

    try {
      const url = `https://www.reddit.com/r/${subredditName}/`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const pageText = await page.evaluate(() => document.body.innerText);
      const isNotFound =
        pageText.includes('Community not found') ||
        pageText.includes('Create a community');
      return !isNotFound;
    } finally {
      await page.close();
      await context.close();
      await browser.close();
    }
  }

  async fetchPostComments(
    subredditName: string,
    postRedditId: string,
    limit: number,
  ): Promise<RedditCommentData[]> {
    const browser = await this.connect();
    const contextOptions = this.getFingerprintContextOptions();
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    const blocker = await this.getAdblocker();
    await blocker.enableBlockingInPage(page);

    try {
      const url = `https://www.reddit.com/r/${subredditName}/comments/${postRedditId}/`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page
        .waitForSelector('shreddit-comment', { timeout: 15000 })
        .catch(() => {});

      const rawComments = await page.evaluate((cLimit) => {
        return Array.from(document.querySelectorAll('shreddit-comment'))
          .slice(0, cLimit)
          .map((el) => {
            const rawId =
              el.getAttribute('thingid') || el.getAttribute('id') || '';
            const parentId = el.getAttribute('parentid') || '';
            const author = el.getAttribute('author') || '';
            const scoreAttr = el.getAttribute('score') || '0';
            const timestampAttr = el.getAttribute('created-timestamp') || '';

            let createdUtc = 0;
            if (timestampAttr) {
              createdUtc = Math.floor(Date.parse(timestampAttr) / 1000);
            }

            const bodyEl = el.querySelector('[slot="comment"]');
            const body = bodyEl ? (bodyEl as HTMLElement).innerText.trim() : '';

            // Strip prefixes for standard IDs
            const cleanId = rawId.replace('t1_', '').replace('t3_', '');
            const cleanParentId = parentId
              .replace('t1_', '')
              .replace('t3_', '');

            return {
              id: cleanId,
              body,
              author,
              score: parseInt(scoreAttr, 10),
              parent_id: cleanParentId,
              created_utc: createdUtc,
            };
          });
      }, limit);

      return rawComments;
    } finally {
      await page.close();
      await context.close();
      await browser.close();
    }
  }
}
