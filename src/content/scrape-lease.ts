import { randomUUID } from 'crypto';

// A run renews its claim on this beat. Three missed beats mean the run is gone -
// crashed, or wedged hard enough that nothing ticks - and the claim may be taken.
export const CLAIM_TICK_MS = 30 * 1000;
export const CLAIM_LEASE_MS = 3 * CLAIM_TICK_MS;

// Hard ceiling on one run. On reaching it the run stops itself AND stops renewing,
// so a run that would never finish frees its subreddit instead of holding it.
export const RUN_CAP_MS = 30 * 60 * 1000;

export type LeaseStopReason = 'claim-lost' | 'time-cap';

/**
 * The three statements a lease needs. The scraper supplies them from its repo.
 *
 * These are callbacks on a plain object rather than real methods, so `this: void`
 * says so out loud: a store is safe to pass around, and nothing here may quietly
 * depend on being called as a property of something.
 */
export interface ClaimStore {
  take(
    this: void,
    subredditId: string,
    token: string,
    staleBefore: Date,
  ): Promise<number>;
  renew(
    this: void,
    subredditId: string,
    token: string,
    at: Date,
  ): Promise<number>;
  release(this: void, subredditId: string, token: string): Promise<void>;
}

/**
 * One run's claim on one subreddit. Taking it is a single conditional statement, so
 * two runs cannot both win; while the run works the lease renews it, and the lease
 * decides when the run must stop - because another run took over, or because this
 * run has been going long enough that it is no longer the best use of the subreddit.
 *
 * The clock is a parameter because a lease is entirely about time: a test that has
 * to sleep through a 30 minute cap is not a test anyone will keep.
 */
export class ScrapeLease {
  private lost = false;
  private expired = false;
  private stopped = false;
  private beatHandle: NodeJS.Timeout | null = null;

  private constructor(
    private readonly store: ClaimStore,
    private readonly subredditId: string,
    readonly token: string,
    private readonly startedAt: number,
    private readonly now: () => number,
  ) {}

  /** Writes its token against a free-or-stale claim; null means someone else holds it. */
  static async take(
    store: ClaimStore,
    subredditId: string,
    now: () => number = Date.now,
    newToken: () => string = randomUUID,
  ): Promise<ScrapeLease | null> {
    const token = newToken();
    const won = await store.take(
      subredditId,
      token,
      new Date(now() - CLAIM_LEASE_MS),
    );
    return won > 0
      ? new ScrapeLease(store, subredditId, token, now(), now)
      : null;
  }

  get shouldStop(): boolean {
    return this.lost || this.expired;
  }

  get stopReason(): LeaseStopReason | null {
    if (this.lost) return 'claim-lost';
    return this.expired ? 'time-cap' : null;
  }

  /** Beats until the run ends; onStop fires once, when a beat decides to stop it. */
  start(
    onStop: (reason: LeaseStopReason) => void,
    tickMs = CLAIM_TICK_MS,
  ): void {
    this.beatHandle = setInterval(() => {
      void this.beat().then((reason) => {
        if (reason) onStop(reason);
      });
    }, tickMs);
    this.beatHandle.unref();
  }

  /** One beat: renew, unless this run has already been going long enough to stop. */
  async beat(): Promise<LeaseStopReason | null> {
    if (this.stopped || this.shouldStop) return null;
    if (this.now() - this.startedAt > RUN_CAP_MS) {
      this.expired = true;
      this.stopBeating();
      return 'time-cap';
    }
    try {
      const renewed = await this.store.renew(
        this.subredditId,
        this.token,
        new Date(this.now()),
      );
      if (renewed === 0) {
        this.lost = true;
        this.stopBeating();
        return 'claim-lost';
      }
    } catch {
      // A failed renewal is a missed beat, not a lost claim: the next beat retries,
      // and if the claim really did expire another run takes it over cleanly.
    }
    return null;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.stopBeating();
    await this.store.release(this.subredditId, this.token);
  }

  private stopBeating(): void {
    if (this.beatHandle) {
      clearInterval(this.beatHandle);
      this.beatHandle = null;
    }
  }
}
