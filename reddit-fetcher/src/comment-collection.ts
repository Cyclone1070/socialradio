import {
  finalizeComments,
  maxChainDepth,
  parseCommentTree,
  toRedditComment,
} from './comments';
import type { RedditCommentData } from './types';

export interface CollectCommentsResult {
  comments: RedditCommentData[];
  renderedCount: number;
  expandedCount: number;
}

export interface CommentTreeReader {
  readTree(): Promise<{ html: string; count: number }>;
  /** Counts comments without transferring the tree. */
  readCount(): Promise<number>;
  clickMoreBatch(maxClicks: number): Promise<number>;
  /** Resolves true when the rendered comment count exceeds `previousCount`. */
  waitForGrowth(previousCount: number, timeoutMs: number): Promise<boolean>;
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
  /** Reports how long an optional phase took (currently `continuation`). */
  onPhase?: (phase: string, ms: number) => void;
  now?: () => number;
}

export const DEFAULT_COMMENT_CAP = 500;
export const DEFAULT_COMMENT_BUDGET_MS = 90_000;

const CLICK_BATCH = 16;
const GROWTH_TIMEOUT_MS = 2_000;

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
  const deadline = now() + budgetMs;

  let tree = await reader.readTree();
  const renderedCount = tree.count;
  let lastCount = tree.count;

  while (lastCount < cap && now() < deadline) {
    let clicked: number;
    try {
      clicked = await reader.clickMoreBatch(CLICK_BATCH);
    } catch {
      break;
    }
    if (clicked === 0) {
      const lateGrowth = await reader
        .waitForGrowth(lastCount, 1_500)
        .catch(() => false);
      if (!lateGrowth) break;
    }
    if (now() >= deadline) break;

    try {
      await reader.waitForGrowth(lastCount, GROWTH_TIMEOUT_MS);
    } catch {
      // a failed wait is treated as no growth; the read below still runs
    }

    if (now() >= deadline) break;
    try {
      lastCount = await reader.readCount();
    } catch {
      break;
    }
    if (now() >= deadline) break;
  }

  if (lastCount > tree.count) {
    try {
      tree = await reader.readTree();
    } catch {
      // keep the initial snapshot rather than losing everything
    }
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
      options.onPhase?.('continuation', now() - continuationStartedAt);
    } catch {
      // continuation failures never fail the extraction
    }
  }

  return {
    comments: finalizeComments(comments, cap, options.postId),
    renderedCount,
    expandedCount: Math.max(0, tree.count - renderedCount),
  };
}
