export interface ContinuationOpenPlan {
  open: boolean;
  gotoTimeoutMs: number;
}

export interface SelectorWaitPlan {
  wait: boolean;
  timeoutMs: number;
}

export interface SubCollectionPlan {
  collect: boolean;
  budgetMs: number;
}

/**
 * Decides whether a continuation page can be opened within the deadline and
 * how long its navigation may take. The 5 s floor keeps a usable page even when
 * little time remains; the 6 s reserve leaves room for the selector wait and a
 * short collection.
 */
export function planContinuationOpen(
  deadline: number,
  now: number,
): ContinuationOpenPlan {
  const remaining = deadline - now;
  if (remaining < 8_000) return { open: false, gotoTimeoutMs: 0 };
  return {
    open: true,
    gotoTimeoutMs: Math.min(30_000, Math.max(5_000, remaining - 6_000)),
  };
}

/**
 * Bounds the selector wait by the time left after navigation, keeping a 4 s
 * reserve for collection.
 */
export function planSelectorWait(
  deadline: number,
  now: number,
): SelectorWaitPlan {
  const remaining = deadline - now;
  if (remaining < 5_000) return { wait: false, timeoutMs: 0 };
  return {
    wait: true,
    timeoutMs: Math.min(10_000, Math.max(2_000, remaining - 4_000)),
  };
}

/**
 * Allocates the sub-collector budget, refusing to start below the 3 s floor.
 */
export function planSubCollection(
  deadline: number,
  now: number,
): SubCollectionPlan {
  const budgetMs = deadline - now - 3_000;
  if (budgetMs < 3_000) return { collect: false, budgetMs: 0 };
  return { collect: true, budgetMs };
}
