/**
 * Global pacing queue: every Reddit request passes through one Pacer, so
 * requests are spaced 1–2s apart regardless of how many backend instances
 * are calling. First request fires immediately (no leading waste); the next
 * request fires 1–2s AFTER the previous one completes (no trailing waste).
 * This is the single point that makes multi-instance scraping safe.
 */
export class Pacer {
  private tail: Promise<unknown> = Promise.resolve();
  private hasScheduled = false;

  run<T>(fn: () => Promise<T>): Promise<T> {
    const start = this.hasScheduled
      ? this.tail.then(() => this.delay())
      : Promise.resolve();
    this.hasScheduled = true;
    const result = start.then(fn);
    // Tail tracks completion (not just start), so the gap is measured from
    // when the previous request actually finished.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private delay(): Promise<void> {
    const ms = Math.floor(Math.random() * 1000) + 1000;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}