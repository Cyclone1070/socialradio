export interface PacerOptions {
  minDelayMs?: number;
  maxDelayMs?: number;
  maxConcurrency?: number;
}

/**
 * Pacing point for Reddit traffic. Requests are chained PER KEY: everything
 * queued under the same key runs strictly one-at-a-time (a subreddit's
 * browser context can only do one thing). Different keys share the global
 * concurrency cap (C2) and a random per-request delay (C3).
 */
export class Pacer {
  readonly minDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxConcurrency: number;

  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly waiters: Array<() => void> = [];
  private inFlight = 0;

  constructor(opts: PacerOptions = {}) {
    this.minDelayMs = opts.minDelayMs ?? 500;
    this.maxDelayMs = opts.maxDelayMs ?? 1000;
    this.maxConcurrency = opts.maxConcurrency ?? 5;
  }

  /** FIFO slot from the global concurrency cap. */
  private async acquire(): Promise<void> {
    if (this.inFlight < this.maxConcurrency) {
      this.inFlight++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.inFlight--;
    }
  }

  /** Random delay per request in [minDelayMs, maxDelayMs]. */
  private async randomDelay(): Promise<void> {
    const ms =
      this.minDelayMs + Math.random() * (this.maxDelayMs - this.minDelayMs);
    await new Promise((r) => setTimeout(r, ms));
  }

  run<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(async () => {
      await this.randomDelay();
      await this.acquire();
      try {
        return await fn();
      } finally {
        this.release();
      }
    });
    // Tail tracks completion (not just start), so the next request for the
    // same key is queued behind the previous one actually finishing.
    this.tails.set(
      key,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }
}
