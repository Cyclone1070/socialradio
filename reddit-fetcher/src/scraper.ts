import type { Page } from 'playwright-core';
import { collectComments } from './comment-collection';
import {
  clickMoreRepliesBatch,
  findContinuationLinks,
  readCommentCount,
  readCommentTree,
  readPostFeed,
  scrollForMorePosts,
  isForbiddenPage,
  waitForCommentGrowth,
  waitForPostGrowth,
  waitForStableTree,
} from './dom';
import type { PostFeedSnapshot } from './dom';
import { parseTopPosts } from './posts';
import {
  planContinuationOpen,
  planSelectorWait,
  planSubCollection,
} from './continuation-budget';
import { BrowserSession } from './browser-session';
import { withTimeout } from './timeout';
import type { RedditCommentData, RedditPostData } from './types';
import pino from 'pino';

export class RedditScraper {
  private readonly session: BrowserSession;
  private readonly logger: pino.Logger;

  constructor(
    wsEndpoint: string,
    logger: pino.Logger = pino({
      level: process.env.LOG_LEVEL ?? 'info',
    }),
  ) {
    this.logger = logger;
    this.session = new BrowserSession(wsEndpoint, logger);
  }

  async fetchTopPosts(
    subredditName: string,
    opts: { limit?: number; after?: string } = {},
  ): Promise<{
    posts: RedditPostData[];
    after: string | null;
    isInvalid: boolean;
  }> {
    const limit = opts.limit ?? 100;
    return this.session.withRetryOnDeadBrowser(subredditName, async (page) => {
      const startedAt = Date.now();
      const deadline = startedAt + 20_000;
      const remaining = () => Math.max(1_000, deadline - Date.now());
      await page.goto(`https://www.reddit.com/r/${subredditName}/top/?t=week`, {
        waitUntil: 'domcontentloaded',
        timeout: remaining(),
      });
      await page
        .waitForSelector('shreddit-post', { timeout: remaining() })
        .catch(() => {});

      let snapshot = await this.session.evaluateSafely<PostFeedSnapshot>(
        page,
        readPostFeed,
      );
      if (!snapshot.valid) {
        return { posts: [], after: null, isInvalid: true };
      }

      let count = snapshot.count;
      let stale = 0;
      while (count < limit && Date.now() < deadline && stale < 3) {
        await this.session
          .evaluateSafely<number>(page, scrollForMorePosts)
          .catch(() => count);
        await this.session
          .evaluateSafely<boolean>(page, waitForPostGrowth, {
            previousCount: count,
            timeoutMs: 1_500,
          })
          .catch(() => false);
        const next = await this.session
          .evaluateSafely<PostFeedSnapshot>(page, readPostFeed)
          .catch(() => null);
        if (!next) break;
        snapshot = next;
        if (next.count > count) {
          count = next.count;
          stale = 0;
        } else {
          stale += 1;
        }
      }

      return {
        posts: parseTopPosts(snapshot.html).slice(0, limit),
        after: null,
        isInvalid: false,
      };
    });
  }

  async exists(subredditName: string): Promise<boolean> {
    return this.session.withRetryOnDeadBrowser(subredditName, async (page) => {
      await page.goto(`https://www.reddit.com/r/${subredditName}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      let snapshot = await this.session.evaluateSafely<PostFeedSnapshot>(
        page,
        readPostFeed,
      );
      if (!snapshot.valid) {
        await page
          .waitForSelector('shreddit-feed, shreddit-subreddit-header', {
            timeout: 5_000,
          })
          .catch(() => {});
        snapshot = await this.session.evaluateSafely<PostFeedSnapshot>(
          page,
          readPostFeed,
        );
      }
      return snapshot.valid;
    });
  }

  /** Reader over a rendered thread page: read the tree, click expansions. */
  private commentReader(page: Page) {
    return {
      readTree: () =>
        this.session.evaluateSafely<{ html: string; count: number }>(
          page,
          readCommentTree,
        ),
      readCount: () =>
        this.session.evaluateSafely<number>(page, readCommentCount),
      clickMoreBatch: (maxClicks: number) =>
        this.session.evaluateSafely<number>(page, clickMoreRepliesBatch, {
          maxClicks,
        }),
      waitForGrowth: (previousCount: number, timeoutMs: number) =>
        this.session
          .evaluateSafely<boolean>(page, waitForCommentGrowth, {
            previousCount,
            timeoutMs,
          })
          .catch(() => false),
    };
  }

  /**
   * Collects the subtrees that only exist behind "continue this thread" links.
   * Each link opens in its own page; the linked comment is already in the main
   * tree, so it is dropped from the continuation result.
   */
  private async collectContinuations(
    page: Page,
    postRedditId: string,
    deadline: number,
  ): Promise<RedditCommentData[]> {
    const links = await this.session.evaluateSafely<
      { href: string; ownerId: string }[]
    >(page, findContinuationLinks);

    const merged: RedditCommentData[] = [];
    const context = page.context();

    for (const link of links.slice(0, 8)) {
      const openPlan = planContinuationOpen(deadline, Date.now());
      if (!openPlan.open) break;
      const continuation = await withTimeout(
        context.newPage(),
        10_000,
        'newPage',
      );
      try {
        await continuation.goto(`https://www.reddit.com${link.href}`, {
          waitUntil: 'domcontentloaded',
          timeout: openPlan.gotoTimeoutMs,
        });
        const waitPlan = planSelectorWait(deadline, Date.now());
        if (!waitPlan.wait) break;
        await continuation
          .waitForSelector('shreddit-comment', { timeout: waitPlan.timeoutMs })
          .catch(() => {});
        const subPlan = planSubCollection(deadline, Date.now());
        if (!subPlan.collect) break;
        const result = await collectComments(this.commentReader(continuation), {
          postId: postRedditId,
          cap: 200,
          budgetMs: subPlan.budgetMs,
        });
        const ownerId = link.ownerId.replace(/^t1_/, '');
        merged.push(...result.comments.filter((c) => c.id !== ownerId));
      } catch {
        // a failed continuation never fails the extraction
      } finally {
        await continuation.close().catch(() => {});
      }
    }

    return merged;
  }

  async fetchPostComments(
    subredditName: string,
    postRedditId: string,
  ): Promise<RedditCommentData[]> {
    const startMs = Date.now();
    return this.session.withRetryOnDeadBrowser(subredditName, async (page) => {
      const url = `https://www.reddit.com/r/${subredditName}/comments/${postRedditId}/`;
      const totalBudgetMs = 80_000;

      const pageReadyMs = Date.now() - startMs;
      await page.goto(url, { waitUntil: 'commit', timeout: 30000 });
      await page
        .waitForSelector('body', { state: 'attached', timeout: 10_000 })
        .catch(() => {});
      await this.session
        .evaluateSafely<number>(page, () => window.scrollTo(0, 800))
        .catch(() => 0);
      const gotoMs = Date.now() - startMs;
      await page
        .waitForSelector('shreddit-comment', {
          state: 'attached',
          timeout: 15000,
        })
        .catch(() => {});
      const selectorMs = Date.now() - startMs;

      const finalUrl = page.url().toLowerCase();
      const expected = `/r/${subredditName.toLowerCase()}/comments/${postRedditId.toLowerCase()}`;
      if (!finalUrl.includes(expected)) {
        throw new Error(
          `reddit redirected away from the requested thread: ${page.url()}`,
        );
      }

      const forbidden = await this.session.evaluateSafely<boolean>(
        page,
        isForbiddenPage,
      );
      if (forbidden) {
        throw new Error('reddit returned a forbidden page');
      }
      const forbiddenMs = Date.now() - startMs;
      await this.session
        .evaluateSafely<number>(page, waitForStableTree, {
          quietMs: 250,
          maxMs: 3_000,
        })
        .catch(() => 0);

      const reader = this.commentReader(page);
      const deadline = startMs + totalBudgetMs;
      const remainingBudgetMs = deadline - Date.now() - 10_000;
      const loadMs = Date.now() - startMs;
      let continuationMs = 0;

      const result = await collectComments(reader, {
        postId: postRedditId,
        budgetMs: Math.max(
          5_000,
          Math.min(remainingBudgetMs, 36_000 - (Date.now() - startMs)),
        ),
        minInlineForContinuations: 200,
        continuationsOnlyBelowChainDepth: 5,
        collectContinuations: () =>
          this.collectContinuations(
            page,
            postRedditId,
            Math.min(deadline, startMs + 45_000),
          ),
        onPhase: (phase, ms) => {
          if (phase === 'continuation') continuationMs = ms;
        },
      });
      const totalMs = Date.now() - startMs;
      const expansionMs = Math.max(0, totalMs - loadMs - continuationMs);

      this.logger.info(
        {
          subreddit: subredditName,
          postId: postRedditId,
          renderedCount: result.renderedCount,
          expandedCount: result.expandedCount,
          returnedCount: result.comments.length,
          loadMs,
          pageReadyMs,
          gotoMs,
          selectorMs,
          forbiddenMs,
          expansionMs,
          continuationMs,
          ms: totalMs,
        },
        'comments collected',
      );

      return result.comments;
    });
  }
}
