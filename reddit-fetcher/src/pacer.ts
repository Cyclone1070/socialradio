/**
 * Global pacing queue: every Reddit request passes through one Pacer, so
 * requests are serialized regardless of how many other instances are
 * calling. Reddit's real per-request latency (~3–4s) already spaces requests;
 * there is NO artificial gap — the spacing you see is genuine scrape time.
 * First request fires immediately; the next fires the instant the previous
 * COMPLETES (no trailing waste). This is the single point that makes
 * multi-instance scraping safe.
 */
export class Pacer {
  private tail: Promise<unknown> = Promise.resolve();
  private hasScheduled = false;

  run<T>(fn: () => Promise<T>): Promise<T> {
    const start = this.hasScheduled ? this.tail : Promise.resolve();
    this.hasScheduled = true;
    const result = start.then(fn);
    // Tail tracks completion (not just start), so the next request is queued
    // behind the previous one actually finishing.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
