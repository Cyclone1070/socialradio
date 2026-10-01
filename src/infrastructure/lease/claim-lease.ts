import { randomUUID } from 'crypto';

export type LeaseStopReason = 'claim-lost' | 'time-cap';

/**
 * The three statements a lease needs, supplied by whoever owns the row. These are
 * callbacks on a plain object rather than methods, so `this: void` says so out
 * loud: a store is safe to pass around, and nothing here may quietly depend on
 * being called as a property of something.
 */
export interface ClaimStore {
  take(
    this: void,
    rowId: string,
    token: string,
    staleBefore: Date,
  ): Promise<number>;
  renew(this: void, rowId: string, token: string, at: Date): Promise<number>;
  release(this: void, rowId: string, token: string): Promise<void>;
}

/** A run renews its claim on every tick; the lease is honoured for three of them. */
export const DEFAULT_TICK_MS = 30 * 1000;

export interface LeaseOptions {
  /**
   * How long the work may hold the claim before it stops itself. Required, because
   * a scrape walk and a buffer batch are different lengths of work and neither
   * should inherit the other's patience.
   */
  capMs: number;
  tickMs?: number;
  leaseMs?: number;
  now?: () => number;
  newToken?: () => string;
}

/**
 * One unit of work's claim on one row. Taking it is a single conditional statement,
 * so two workers cannot both win; while the work runs the lease renews it, and the
 * lease decides when the work must stop - because another worker took over, or
 * because it has been going long enough.
 *
 * The clock is a parameter because a lease is entirely about time: a test that has
 * to sleep through a ten minute cap is not a test anyone will keep.
 */
export class ClaimLease {
  private lost = false;
  private expired = false;
  private stopped = false;
  private beatHandle: NodeJS.Timeout | null = null;

  private constructor(
    private readonly store: ClaimStore,
    private readonly rowId: string,
    readonly token: string,
    private readonly startedAt: number,
    private readonly now: () => number,
    private readonly capMs: number,
  ) {}

  /** Writes its token against a free-or-stale claim; null means someone else holds it. */
  static async take(
    store: ClaimStore,
    rowId: string,
    options: LeaseOptions,
  ): Promise<ClaimLease | null> {
    const now = options.now ?? Date.now;
    const newToken = options.newToken ?? randomUUID;
    const leaseMs = options.leaseMs ?? 3 * (options.tickMs ?? DEFAULT_TICK_MS);
    const token = newToken();
    const won = await store.take(rowId, token, new Date(now() - leaseMs));
    return won > 0
      ? new ClaimLease(store, rowId, token, now(), now, options.capMs)
      : null;
  }

  get shouldStop(): boolean {
    return this.lost || this.expired;
  }

  get stopReason(): LeaseStopReason | null {
    if (this.lost) return 'claim-lost';
    return this.expired ? 'time-cap' : null;
  }

  /** Beats until the work ends; onStop fires once, when a beat decides to stop it. */
  start(
    onStop: (reason: LeaseStopReason) => void,
    tickMs = DEFAULT_TICK_MS,
  ): void {
    this.beatHandle = setInterval(() => {
      void this.beat().then((reason) => {
        if (reason) onStop(reason);
      });
    }, tickMs);
    this.beatHandle.unref();
  }

  /** One beat: renew, unless this work has already been going long enough to stop. */
  async beat(): Promise<LeaseStopReason | null> {
    if (this.stopped || this.shouldStop) return null;
    if (this.now() - this.startedAt > this.capMs) {
      this.expired = true;
      this.stopBeating();
      return 'time-cap';
    }
    try {
      const renewed = await this.store.renew(
        this.rowId,
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
      // and if the claim really did expire another worker takes it over cleanly.
    }
    return null;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.stopBeating();
    await this.store.release(this.rowId, this.token);
  }

  private stopBeating(): void {
    if (this.beatHandle) {
      clearInterval(this.beatHandle);
      this.beatHandle = null;
    }
  }
}
