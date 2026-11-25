import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { FingerprintGenerator } from 'fingerprint-generator';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { withTimeout } from './timeout';
import pino from 'pino';

// Idle per-subreddit contexts are closed after 10 minutes.
const CONTEXT_IDLE_MS = 10 * 60 * 1000;

/**
 * Reddit's per-context quota starts around 221 units and drops by ~9 per full
 * comment page. Rotate before the bucket empties so the next page load starts
 * on a fresh context instead of returning 429.
 */
const DEFAULT_QUOTA_ROTATE_AT = 40;
const DEFAULT_MAX_PAGES_PER_CONTEXT = 18;

/**
 * Owns the browserless connection, the per-subreddit context cache, and the
 * retry policy. Scraping code gets a page and never touches the socket.
 */
export class BrowserSession {
  private browser: Browser | null = null;
  private readonly fingerprintGenerator = new FingerprintGenerator();
  private readonly contexts = new Map<string, BrowserContext>();
  private readonly lastUsedAt = new Map<string, number>();
  private readonly staleContexts = new Set<string>();
  private readonly quotaRemaining = new Map<string, number>();
  private readonly quotaExhausted = new Set<string>();
  private readonly pagesInContext = new Map<string, number>();
  private readonly quotaFloor = this.numberFromEnv(
    'REDDIT_CONTEXT_QUOTA_FLOOR',
    10,
  );
  private readonly quotaRotateAt = this.numberFromEnv(
    'REDDIT_CONTEXT_QUOTA_MIN',
    DEFAULT_QUOTA_ROTATE_AT,
  );
  private readonly maxPagesPerContext = this.numberFromEnv(
    'REDDIT_CONTEXT_MAX_PAGES',
    DEFAULT_MAX_PAGES_PER_CONTEXT,
  );

  private numberFromEnv(name: string, fallback: number): number {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  /** Watch every response in a context, not just the main thread document. */
  private watchQuota(subredditName: string, context: BrowserContext): void {
    if (this.isCdp || typeof context.on !== 'function') return;
    context.on('response', (response) => {
      const remaining = response.headers()['x-ratelimit-remaining'];
      if (remaining !== undefined) this.noteQuota(subredditName, remaining);
    });
  }

  constructor(
    private readonly wsEndpoint: string,
    private readonly logger: pino.Logger = pino({
      level: process.env.LOG_LEVEL ?? 'info',
    }),
  ) {
    chromium.use(StealthPlugin());
  }

  /** Connects to browserless (ws) or attaches to a running Chrome (http). */
  private async connect(): Promise<Browser> {
    if (!this.browser) {
      this.browser =
        this.wsEndpoint === 'local'
          ? await chromium.launch({ headless: true, channel: 'chrome' })
          : /^https?:\/\//.test(this.wsEndpoint)
            ? await chromium.connectOverCDP(this.wsEndpoint)
            : await chromium.connect(this.wsEndpoint);
      this.logger.info({}, 'browser connected');
    }
    return this.browser;
  }

  private get isCdp(): boolean {
    return /^https?:\/\//.test(this.wsEndpoint);
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

  /**
   * Record the quota header Reddit sends with comment responses. When the
   * bucket is nearly empty the current context is marked stale; the next
   * operation rotates to a fresh context before it can hit 429.
   */
  noteQuota(subredditName: string, remaining: string | number | null): void {
    const value = Number(remaining);
    if (!Number.isFinite(value)) return;
    this.quotaRemaining.set(subredditName, value);
    if (value <= this.quotaFloor) this.quotaExhausted.add(subredditName);
    if (value <= this.quotaRotateAt && !this.staleContexts.has(subredditName)) {
      this.staleContexts.add(subredditName);
      this.logger.info(
        {
          subreddit: subredditName,
          remaining: value,
          rotateAt: this.quotaRotateAt,
        },
        'reddit context quota low, rotating context',
      );
    }
  }

  /** True once a response reported the quota at or below the hard floor. */
  isQuotaExhausted(subredditName: string): boolean {
    return this.quotaExhausted.has(subredditName);
  }

  /** Close one subreddit's context; the next operation gets fresh cookies. */
  async rotateContext(subredditName: string): Promise<void> {
    const context = this.contexts.get(subredditName);
    this.contexts.delete(subredditName);
    this.lastUsedAt.delete(subredditName);
    this.staleContexts.delete(subredditName);
    this.quotaRemaining.delete(subredditName);
    this.quotaExhausted.delete(subredditName);
    this.pagesInContext.delete(subredditName);
    if (context) {
      await context.close().catch(() => {});
      this.logger.info({ subreddit: subredditName }, 'reddit context rotated');
    }
  }

  /** Context affinity: same subreddit → same context; different sub → fresh. */
  private async getContext(subredditName: string): Promise<BrowserContext> {
    if (this.staleContexts.has(subredditName)) {
      await this.rotateContext(subredditName);
    }
    const existing = this.contexts.get(subredditName);
    if (existing) {
      this.lastUsedAt.set(subredditName, Date.now());
      return existing;
    }

    const now = Date.now();
    for (const [sub, context] of this.contexts) {
      const lastUsed = this.lastUsedAt.get(sub) ?? 0;
      if (!this.isCdp && now - lastUsed > CONTEXT_IDLE_MS) {
        this.logger.debug({ subreddit: sub }, 'idle context evicted');
        await context.close().catch(() => {});
        this.contexts.delete(sub);
        this.lastUsedAt.delete(sub);
      }
    }

    const browser = await this.connect();
    if (this.isCdp) {
      // A real Chrome already has its own (warm) default context.
      const context = browser.contexts()[0] ?? (await browser.newContext());
      this.contexts.set(subredditName, context);
      this.lastUsedAt.set(subredditName, now);
      this.watchQuota(subredditName, context);
      return context;
    }
    const context = await browser.newContext(
      this.getFingerprintContextOptions(),
    );
    this.contexts.set(subredditName, context);
    this.lastUsedAt.set(subredditName, now);
    this.watchQuota(subredditName, context);
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
    let rateLimitRetried = false;
    let connectionRetried = false;
    for (;;) {
      if (this.staleContexts.has(subredditName)) {
        await this.rotateContext(subredditName);
      }
      try {
        return await this.withPage(subredditName, fn);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          !rateLimitRetried &&
          /HTTP 429|rate limit|challenge|stopped expanding|rendered only/i.test(
            message,
          )
        ) {
          rateLimitRetried = true;
          this.logger.warn(
            { subreddit: subredditName },
            'reddit rate limited the context, retrying on a fresh context',
          );
          await this.rotateContext(subredditName);
          continue;
        }
        if (
          !connectionRetried &&
          /closed|connection|Request has timed out|Target closed/i.test(message)
        ) {
          connectionRetried = true;
          this.logger.warn(
            { subreddit: subredditName },
            'browser session died, reconnecting and retrying',
          );
          await this.invalidateConnection();
          continue;
        }
        throw err;
      }
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
    this.staleContexts.clear();
    this.quotaRemaining.clear();
    this.quotaExhausted.clear();
    this.pagesInContext.clear();
    this.logger.info({}, 'browser connection invalidated');
  }

  private async withPage<T>(
    subredditName: string,
    fn: (page: Page) => Promise<T>,
  ): Promise<T> {
    const context = await this.getContext(subredditName);
    const pages = (this.pagesInContext.get(subredditName) ?? 0) + 1;
    this.pagesInContext.set(subredditName, pages);
    if (
      pages >= this.maxPagesPerContext &&
      !this.staleContexts.has(subredditName)
    ) {
      this.staleContexts.add(subredditName);
      this.logger.info(
        {
          subreddit: subredditName,
          pages,
          maxPages: this.maxPagesPerContext,
        },
        'reddit context page budget reached, rotating next operation',
      );
    }
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
