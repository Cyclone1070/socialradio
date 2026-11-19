import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { FingerprintGenerator } from 'fingerprint-generator';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { withTimeout } from './timeout';
import pino from 'pino';

// Idle per-subreddit contexts are closed after 10 minutes.
const CONTEXT_IDLE_MS = 10 * 60 * 1000;

/**
 * Owns the browserless connection, the per-subreddit context cache, and the
 * retry policy. Scraping code gets a page and never touches the socket.
 */
export class BrowserSession {
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
  async withRetryOnDeadBrowser<T>(
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
    const page = await withTimeout(context.newPage(), 10_000, 'newPage');
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
  async evaluateSafely<T>(
    page: Page,
    fn: (arg: never) => unknown,
    arg?: unknown,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await withTimeout(
          page.evaluate(fn as never, arg),
          10_000,
          'evaluate',
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/closed|connection|timed out/i.test(message)) {
          throw error; // let withRetryOnDeadBrowser reconnect the browser
        }
        lastError = error;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    throw lastError;
  }
}
