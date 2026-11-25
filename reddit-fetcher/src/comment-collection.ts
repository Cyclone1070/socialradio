import {
  finalizeComments,
  maxChainDepth,
  parseCommentTree,
  toRedditComment,
} from './comments';
import type { RedditCommentData } from './types';

export interface CommentCollectionTimings {
  initialReadMs: number;
  clickMs: number;
  growthWaitMs: number;
  settleMs: number;
  countReadMs: number;
  finalReadMs: number;
  continuationMs: number;
  totalMs: number;
  rounds: number;
  clicks: number;
}

export interface CollectCommentsResult {
  comments: RedditCommentData[];
  renderedCount: number;
  expandedCount: number;
  timings: CommentCollectionTimings;
}

export interface CommentTreeReader {
  readTree(): Promise<{ html: string; count: number }>;
  /** Counts comments without transferring the tree. */
  readCount(): Promise<number>;
  clickMoreBatch(maxClicks: number, force?: boolean): Promise<number>;
  /** Resolves true when the rendered comment count exceeds `previousCount`. */
  waitForGrowth(previousCount: number, timeoutMs: number): Promise<boolean>;
  /** Optional combined growth + count read, avoiding a second RPC. */
  waitForGrowthCount?(
    previousCount: number,
    timeoutMs: number,
  ): Promise<{ count: number; grew: boolean }>;
}

export interface CollectCommentsOptions {
  postId: string;
  collectContinuations?: () => Promise<RedditCommentData[]>;
  cap?: number;
  budgetMs?: number;
  /** Skip continuation pages when this many inline comments were collected. */
  minInlineForContinuations?: number;
  /** Skip continuation pages when the inline chain is at least this deep. */
  continuationsOnlyBelowChainDepth?: number;
  /** Quiet time after a batch before the next count read. */
  settleMs?: number;
  /** Stop starting new rounds when the browser quota is nearly empty. */
  shouldStop?: () => boolean;
  /** Reports how long an optional phase took (currently `continuation`). */
  onPhase?: (phase: string, ms: number) => void;
  now?: () => number;
}

export const DEFAULT_COMMENT_CAP = 500;
export const DEFAULT_COMMENT_BUDGET_MS = 90_000;

const CLICK_BATCH = 32;
const GROWTH_TIMEOUT_MS = 2_000;
const SETTLE_MS = 0;
const STABLE_ROUNDS = 2;

/**
 * Detects a page that rendered only a fraction of the thread's advertised
 * comment count. A challenged/partial render can expose 25 comments with no
 * expansion controls; that is not a valid short thread.
 */
export function isPartialCommentRender(arg: {
  collected: number;
  expected: number;
  softCap: number;
}): boolean {
  if (!Number.isFinite(arg.expected) || arg.expected < 200) return false;
  // A normal render can legitimately expose only part of the advertised total
  // (deleted/removed comments, collapsed branches). A challenged render is a
  // tiny fraction, not merely half.
  return arg.collected < Math.min(arg.softCap, Math.floor(arg.expected * 0.25));
}

/**
 * True when the soft cap was reached before the word guard, so collection must
 * continue to the hard cap. This preserves validity without always paying for
 * 500 comments on high-volume threads.
 */
export function shouldResumeForWordGuard(arg: {
  collected: number;
  softCap: number;
  words: number;
  minWords: number;
}): boolean {
  return arg.collected >= arg.softCap && arg.words < arg.minWords;
}

/**
 * Expands the rendered comment tree inline, clicking batches of "more replies"
 * controls, and returns the parsed comments. Never navigates: the only
 * interactions are reading the tree and clicking expansion controls.
 */
export async function collectComments(
  reader: CommentTreeReader,
  options: CollectCommentsOptions,
): Promise<CollectCommentsResult> {
  const cap = options.cap ?? DEFAULT_COMMENT_CAP;
  const budgetMs = options.budgetMs ?? DEFAULT_COMMENT_BUDGET_MS;
  const now = options.now ?? Date.now;
  const settleMs = options.settleMs ?? SETTLE_MS;
  const phaseStart = now();
  let initialReadMs = 0;
  let clickMs = 0;
  let growthWaitMs = 0;
  let settleTotalMs = 0;
  let countReadMs = 0;
  let finalReadMs = 0;
  let continuationMs = 0;
  let rounds = 0;
  let clicks = 0;
  const deadline = now() + budgetMs;

  const readStart = now();
  let tree = await reader.readTree();
  initialReadMs += now() - readStart;
  const renderedCount = tree.count;
  let lastCount = tree.count;
  let stableRounds = 0;
  let stalledRounds = 0;
  let forcedSweeps = 0;

  while (lastCount < cap && now() < deadline) {
    if (options.shouldStop?.()) break;
    rounds += 1;
    let clicked: number;
    const force = forcedSweeps > 0;
    const clickStart = now();
    try {
      clicked = await reader.clickMoreBatch(CLICK_BATCH, force);
    } catch {
      break;
    }
    clickMs += now() - clickStart;
    clicks += clicked;

    let observedCount: number | null = null;
    if (clicked > 0) {
      const growthStart = now();
      let grew = false;
      try {
        if (reader.waitForGrowthCount) {
          const growth = await reader.waitForGrowthCount(
            lastCount,
            GROWTH_TIMEOUT_MS,
          );
          observedCount = growth.count;
          grew = growth.grew;
        } else {
          grew = await reader.waitForGrowth(lastCount, GROWTH_TIMEOUT_MS);
        }
      } catch {
        // a failed wait is treated as no growth; the read below still runs
      }
      growthWaitMs += now() - growthStart;

      // Only give the rest of the batch a grace period when the first growth
      // actually arrived. After a timeout, sleeping again is pure latency.
      if (grew && settleMs > 0) {
        const settleStart = now();
        await new Promise((resolve) => setTimeout(resolve, settleMs));
        settleTotalMs += now() - settleStart;
      }
    }
    if (now() >= deadline) break;

    let current: number;
    if (observedCount !== null) {
      current = observedCount;
    } else {
      const countStart = now();
      try {
        current = await reader.readCount();
      } catch {
        break;
      }
      countReadMs += now() - countStart;
    }
    if (current === lastCount) {
      stableRounds += 1;
      if (clicked > 0) stalledRounds += 1;
    } else {
      stableRounds = 0;
      stalledRounds = 0;
    }
    lastCount = current;
    if (options.shouldStop?.()) break;
    if (stalledRounds >= 3) {
      throw new Error(
        'reddit comment tree stopped expanding while controls remained',
      );
    }

    if (clicked === 0 && stableRounds >= STABLE_ROUNDS) {
      // A batch can be dropped under load even though the button stays put;
      // one forced sweep re-clicks those controls before declaring the end.
      if (forcedSweeps < 1) {
        forcedSweeps += 1;
        stableRounds = 0;
        continue;
      }
      break;
    }
    if (clicked > 0 && stableRounds >= 4) {
      // Controls can stay clickable forever after their replies loaded. Give
      // slow renders a short grace period, then stop.
      if (forcedSweeps < 1) {
        forcedSweeps += 1;
        stableRounds = 0;
        continue;
      }
      break;
    }
    if (clicked > 0 && stableRounds === 0) forcedSweeps = 0;
  }

  if (lastCount > tree.count) {
    const finalStart = now();
    try {
      tree = await reader.readTree();
    } catch {
      // keep the initial snapshot rather than losing everything
    }
    finalReadMs += now() - finalStart;
  }

  const comments = parseCommentTree(tree.html).map((raw) =>
    toRedditComment(raw, options.postId),
  );

  const enoughInline =
    comments.length >= (options.minInlineForContinuations ?? Infinity);
  const deepEnough =
    maxChainDepth(comments, options.postId) >=
    (options.continuationsOnlyBelowChainDepth ?? Infinity);
  if (
    comments.length < cap &&
    !enoughInline &&
    !deepEnough &&
    options.collectContinuations &&
    now() < deadline
  ) {
    try {
      const continuationStartedAt = now();
      comments.push(...(await options.collectContinuations()));
      continuationMs += now() - continuationStartedAt;
      options.onPhase?.('continuation', continuationMs);
    } catch {
      // continuation failures never fail the extraction
    }
  }

  return {
    comments: finalizeComments(comments, cap, options.postId),
    renderedCount,
    expandedCount: Math.max(0, tree.count - renderedCount),
    timings: {
      initialReadMs,
      clickMs,
      growthWaitMs,
      settleMs: settleTotalMs,
      countReadMs,
      finalReadMs,
      continuationMs,
      totalMs: now() - phaseStart,
      rounds,
      clicks,
    },
  };
}
