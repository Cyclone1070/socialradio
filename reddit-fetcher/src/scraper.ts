import type { Page, Response } from 'playwright-core';
import {
  collectComments,
  isPartialCommentRender,
  shouldResumeForWordGuard,
} from './comment-collection';
import {
  fetchEmbeddedComments,
  type EmbeddedCommentsResult,
} from './embed-comments';
import {
  clickMoreRepliesBatch,
  findContinuationLinks,
  findVisibleContinuationLinks,
  isRedditChallengeUrl,
  readExpectedCommentCount,
  dismissLoginModal,
  readCommentCount,
  readCommentTree,
  readPostFeed,
  fetchMorePosts,
  scrollForMorePosts,
  isForbiddenPage,
  waitForCommentGrowth,
  waitForCommentGrowthCount,
  waitForPostGrowth,
  waitForStableTree,
} from './dom';
import type { PostFeedSnapshot } from './dom';
import { finalizeComments } from './comments';
import { parseTopPosts } from './posts';

function countWords(body: string | null | undefined): number {
  return (body ?? '').trim().split(/\s+/).filter(Boolean).length;
}

const HREF_PAGE_LIMIT = 8;
const HREF_BUDGET_MS = 15_000;
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
    private readonly embedFetcher: (
      subreddit: string,
      postId: string,
      options?: { cap?: number },
    ) => Promise<EmbeddedCommentsResult> = fetchEmbeddedComments,
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
      const deadline = startedAt + 60_000;
      const remaining = () => Math.max(1_000, deadline - Date.now());
      const url = new URL(`https://www.reddit.com/r/${subredditName}/top/`);
      url.searchParams.set('t', 'week');
      if (opts.after) url.searchParams.set('after', opts.after);
      await page.goto(url.toString(), {
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

      const posts = parseTopPosts(snapshot.html).slice(0, limit);
      const seen = new Set(posts.map((post) => post.id));
      const merge = (html: string): number => {
        let added = 0;
        for (const post of parseTopPosts(html)) {
          if (seen.has(post.id)) continue;
          seen.add(post.id);
          posts.push(post);
          added += 1;
          if (posts.length >= limit) break;
        }
        return added;
      };

      // The SSR page is a teaser for logged-out readers. Reddit exposes its own
      // server-rendered "more posts" endpoint on <shreddit-feed reload-url>.
      let pageFetches = 0;
      while (
        snapshot.reloadUrl &&
        posts.length < limit &&
        Date.now() < deadline &&
        pageFetches < 10
      ) {
        const last = posts[posts.length - 1];
        if (!last) break;
        const separator = snapshot.reloadUrl.includes('?') ? '&' : '?';
        const more = await this.session
          .evaluateSafely<{ ok: boolean; html: string; count: number }>(
            page,
            fetchMorePosts,
            `${snapshot.reloadUrl}${separator}after=t3_${last.id}`,
          )
          .catch(() => null);
        pageFetches += 1;
        if (!more?.ok || more.count === 0 || merge(more.html) === 0) break;
      }

      // Older/alternate feeds without a reload-url still use real scrolling.
      let count = snapshot.count;
      let stale = 0;
      while (posts.length < limit && Date.now() < deadline && stale < 5) {
        await this.session
          .evaluateSafely<number>(page, scrollForMorePosts)
          .catch(() => count);
        // A real wheel event after the scroll helps Reddit's IntersectionObserver
        // fetch the next page; evaluate-only scrolling can be ignored.
        if (page.mouse) {
          await page.mouse.wheel(0, 3_000).catch(() => undefined);
        }
        await this.session
          .evaluateSafely<boolean>(page, waitForPostGrowth, {
            previousCount: count,
            timeoutMs: 2_000,
          })
          .catch(() => false);
        const next = await this.session
          .evaluateSafely<PostFeedSnapshot>(page, readPostFeed)
          .catch(() => null);
        if (!next) break;
        snapshot = next;
        const added = merge(next.html);
        if (next.count > count || added > 0) {
          count = next.count;
          stale = 0;
        } else {
          stale += 1;
        }
      }

      return {
        posts: posts.slice(0, limit),
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
      clickMoreBatch: (maxClicks: number, force?: boolean) =>
        this.session.evaluateSafely<number>(page, clickMoreRepliesBatch, {
          maxClicks,
          force,
        }),
      waitForGrowth: (previousCount: number, timeoutMs: number) =>
        this.session
          .evaluateSafely<boolean>(page, waitForCommentGrowth, {
            previousCount,
            timeoutMs,
          })
          .catch(() => false),
      waitForGrowthCount: (previousCount: number, timeoutMs: number) =>
        this.session.evaluateSafely<{ count: number; grew: boolean }>(
          page,
          waitForCommentGrowthCount,
          { previousCount, timeoutMs },
        ),
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
    settleMs?: number,
  ): Promise<RedditCommentData[]> {
    const links = await this.session.evaluateSafely<
      { href: string; ownerId: string; depth?: number; more?: number }[]
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
          settleMs,
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

  /**
   * Follows continuation links depth-first, one tab per page. Each focused page
   * is standalone, so the thread page is never re-rendered and no back
   * navigation is needed. Roots are stitched to the comment that owned the
   * link; hidden controls are covered too.
   */
  private async collectByHref(
    page: Page,
    postRedditId: string,
    collected: RedditCommentData[],
    merged: RedditCommentData[],
    visited: Set<string>,
    deadline: number,
    links: { href: string; ownerId: string; depth?: number; more?: number }[],
    baseWords: number,
    minWords: number,
  ): Promise<{
    pages: number;
    emptyPages: number;
    added: number;
    elapsedMs: number;
    stoppedByWords: boolean;
  }> {
    const startedAt = Date.now();
    const passDeadline = Math.min(deadline - 8_000, startedAt + HREF_BUDGET_MS);
    const normalize = (href: string): string =>
      href.split('?')[0].replace(/\/$/, '');
    if (!Array.isArray(links)) {
      return {
        pages: 0,
        emptyPages: 0,
        added: 0,
        elapsedMs: 0,
        stoppedByWords: false,
      };
    }

    // Depth-limited DFS: each top-level anchor gets at most three hops before
    // the walk moves to the next anchor, so one giant chain cannot monopolize
    // the page budget.
    const MAX_HOPS = 3;
    const queue: {
      href: string;
      ownerId: string;
      depth?: number;
      more?: number;
      hop: number;
    }[] = links
      .filter((link) => !visited.has(normalize(link.href)))
      .map((link) => ({ ...link, hop: 0 }))
      .reverse();
    const context = page.context();
    let pages = 0;
    let emptyPages = 0;
    let added = 0;
    let collectedWords = baseWords;
    let stoppedByWords = false;

    while (
      queue.length > 0 &&
      pages < HREF_PAGE_LIMIT &&
      Date.now() < passDeadline - 1_000
    ) {
      const link = queue.pop();
      if (!link || visited.has(normalize(link.href))) continue;
      visited.add(normalize(link.href));
      pages += 1;

      let continuation: Page | null = null;
      try {
        continuation = await withTimeout(context.newPage(), 10_000, 'newPage');
        await withTimeout(
          continuation.goto(`https://www.reddit.com${link.href}`, {
            waitUntil: 'domcontentloaded',
            timeout: 20_000,
          }),
          22_000,
          'continuation goto',
        );
        await withTimeout(
          continuation.waitForSelector('shreddit-comment', {
            state: 'attached',
            timeout: 12_000,
          }),
          14_000,
          'continuation comments',
        ).catch(() => {});
        await this.session
          .evaluateSafely<number>(continuation, dismissLoginModal)
          .catch(() => 0);
        await this.session
          .evaluateSafely<number>(continuation, waitForStableTree, {
            quietMs: 300,
            maxMs: 2_000,
          })
          .catch(() => 0);
        const next = await this.session
          .evaluateSafely<
            { href: string; ownerId: string; depth?: number; more?: number }[]
          >(continuation, findContinuationLinks)
          .catch(() => []);
        const budget = Math.max(
          1_000,
          Math.min(3_000, passDeadline - Date.now() - 1_000),
        );
        const result = await collectComments(this.commentReader(continuation), {
          postId: postRedditId,
          cap: 200,
          budgetMs: budget,
          settleMs: 0,
        });
        if (result.comments.length === 0) emptyPages += 1;
        added += result.comments.length;
        this.logger.debug(
          {
            href: link.href,
            count: result.comments.length,
            pages,
            queue: queue.length,
          },
          'href continuation collected',
        );
        for (const comment of result.comments) {
          if (comment.id === link.ownerId) continue;
          merged.push(
            comment.parent_id === postRedditId
              ? { ...comment, parent_id: link.ownerId }
              : comment,
          );
          collectedWords += countWords(comment.body);
        }
        if (collectedWords >= minWords) {
          stoppedByWords = true;
          break;
        }
        if (emptyPages >= 3) break;
        if (Array.isArray(next) && link.hop < MAX_HOPS) {
          const fresh = next
            .filter((candidate) => !visited.has(normalize(candidate.href)))
            .map((candidate) => ({ ...candidate, hop: link.hop + 1 }))
            .sort((a, b) => (b.more ?? 0) - (a.more ?? 0));
          queue.push(...fresh.reverse());
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A dead browser makes every later call time out; abort instead of
        // limping through the rest of the queue.
        if (/closed|connection|browser/i.test(message)) throw error;
      } finally {
        await continuation?.close().catch(() => {});
      }
    }
    const elapsedMs = Date.now() - startedAt;
    this.logger.info(
      {
        pages,
        emptyPages,
        added,
        queued: queue.length,
        visited: visited.size,
        elapsedMs,
        stoppedByWords,
      },
      'continuation pass finished',
    );
    return { pages, emptyPages, added, elapsedMs, stoppedByWords };
  }

  async fetchPostComments(
    subredditName: string,
    postRedditId: string,
    options: {
      cap?: number;
      /** Stop expanding at this cap when the word guard is already met. */
      softCap?: number;
      totalBudgetMs?: number;
      commentBudgetMs?: number;
      /** Skip continuation tabs once inline comments reach this word count. */
      minWordsForContinuations?: number;
      /** Test-only: quiet time between expansion rounds. */
      settleMs?: number;
    } = {},
  ): Promise<RedditCommentData[]> {
    if (process.env.REDDIT_EMBED_COMMENTS === 'true') {
      try {
        const embedded = await this.embedFetcher(subredditName, postRedditId, {
          cap: options.cap ?? 500,
        });
        const words = embedded.comments.reduce(
          (sum, comment) =>
            sum + comment.body.split(/\s+/).filter(Boolean).length,
          0,
        );
        if (embedded.comments.length > 0 && words >= 2_500) {
          this.logger.info(
            {
              subreddit: subredditName,
              postId: postRedditId,
              returnedCount: embedded.comments.length,
              words,
              remaining: embedded.remaining,
              source: 'embed',
            },
            'comments collected from embed',
          );
          return embedded.comments;
        }
        this.logger.debug(
          {
            subreddit: subredditName,
            postId: postRedditId,
            returnedCount: embedded.comments.length,
            words,
          },
          'embed comments insufficient — using browser',
        );
      } catch (err) {
        this.logger.warn(
          {
            subreddit: subredditName,
            postId: postRedditId,
            err: err instanceof Error ? err.message : String(err),
          },
          'embed comments failed — using browser',
        );
      }
    }
    const startMs = Date.now();
    return this.session.withRetryOnDeadBrowser(subredditName, async (page) => {
      const url = `https://www.reddit.com/r/${subredditName}/comments/${postRedditId}/`;
      const totalBudgetMs = options.totalBudgetMs ?? 80_000;

      const pageReadyMs = Date.now() - startMs;
      let rejectedStatus: number | null = null;
      const onResponse = (response: Response): void => {
        const remaining = response.headers()['x-ratelimit-remaining'];
        if (remaining !== undefined) {
          this.session.noteQuota(subredditName, remaining);
          if (Number(remaining) <= 60) {
            this.logger.info(
              {
                subreddit: subredditName,
                postId: postRedditId,
                remaining: Number(remaining),
                url: response.url(),
              },
              'reddit comment quota',
            );
          }
        }
        if (
          response.status() >= 400 &&
          response.url().includes(`/comments/${postRedditId}`)
        ) {
          rejectedStatus = response.status();
          this.logger.warn(
            {
              subreddit: subredditName,
              postId: postRedditId,
              status: response.status(),
              retryAfter: response.headers()['retry-after'] ?? null,
              rateLimitRemaining: remaining ?? null,
              url: response.url(),
            },
            'reddit rejected the comment page',
          );
        }
      };
      page.on('response', onResponse);
      let navigationResponse: Response | null = null;
      try {
        navigationResponse = await withTimeout(
          page.goto(url, { waitUntil: 'commit', timeout: 30000 }),
          32_000,
          'goto',
        );
      } catch (err) {
        if (rejectedStatus !== null) {
          throw new Error(`reddit comment page HTTP ${String(rejectedStatus)}`);
        }
        throw err;
      }
      if (
        rejectedStatus !== null ||
        (navigationResponse != null && navigationResponse.status() >= 400)
      ) {
        const status = rejectedStatus ?? navigationResponse?.status();
        throw new Error(`reddit comment page HTTP ${String(status)}`);
      }
      await withTimeout(
        page.waitForSelector('body', { state: 'attached', timeout: 10_000 }),
        12_000,
        'body',
      ).catch(() => {});
      await this.session
        .evaluateSafely<number>(page, () => window.scrollTo(0, 800))
        .catch(() => 0);
      const gotoMs = Date.now() - startMs;
      await withTimeout(
        page.waitForSelector('shreddit-comment', {
          state: 'attached',
          timeout: 15000,
        }),
        16_000,
        'comments',
      ).catch(() => {});
      const selectorMs = Date.now() - startMs;

      const finalUrl = page.url().toLowerCase();
      const expected = `/r/${subredditName.toLowerCase()}/comments/${postRedditId.toLowerCase()}`;
      if (!finalUrl.includes(expected)) {
        throw new Error(
          `reddit redirected away from the requested thread: ${page.url()}`,
        );
      }

      if (isRedditChallengeUrl(page.url())) {
        const challengeComments = await this.session
          .evaluateSafely<number>(
            page,
            () => document.querySelectorAll('shreddit-comment').length,
          )
          .catch(() => 0);
        if (challengeComments === 0) {
          throw new Error('reddit returned a JS challenge page');
        }
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

      await this.session
        .evaluateSafely<number>(page, dismissLoginModal)
        .catch(() => 0);

      const expectedCommentCount = await this.session
        .evaluateSafely<number>(page, readExpectedCommentCount)
        .catch(() => 0);
      const reader = this.commentReader(page);
      const deadline = startMs + totalBudgetMs;
      const remainingBudgetMs = deadline - Date.now() - 10_000;
      const loadMs = Date.now() - startMs;
      let continuationMs = 0;
      let quotaStopped = false;
      const shouldStop = () => {
        const exhausted = this.session.isQuotaExhausted(subredditName);
        if (exhausted) quotaStopped = true;
        return exhausted;
      };
      const hardCap = options.cap ?? 500;
      const softCap = Math.min(
        options.softCap ?? (Number(process.env.REDDIT_COMMENT_SOFT_CAP) || 250),
        hardCap,
      );
      const minWordsForContinuations =
        options.minWordsForContinuations ?? 2_500;
      const budgetMs =
        options.commentBudgetMs ??
        Math.max(10_000, Math.min(remainingBudgetMs, 50_000));
      const baseResult = await collectComments(reader, {
        postId: postRedditId,
        cap: softCap,
        settleMs: options.settleMs,
        // Page load can consume most of the old fixed 36s expansion window;
        // that stopped collection at 25 comments. Keep a real expansion
        // window after the page is ready, bounded by the request deadline.
        budgetMs,
        minInlineForContinuations: 200,
        continuationsOnlyBelowChainDepth: 5,
        shouldStop,
        collectContinuations: () =>
          this.collectContinuations(
            page,
            postRedditId,
            Math.min(deadline, startMs + 45_000),
            options.settleMs,
          ),
        onPhase: (phase, ms) => {
          if (phase === 'continuation') continuationMs = ms;
        },
      });
      let result = baseResult;
      let comments = baseResult.comments;
      let inlineWords = comments.reduce(
        (total, comment) => total + countWords(comment.body),
        0,
      );
      if (
        shouldResumeForWordGuard({
          collected: comments.length,
          softCap,
          words: inlineWords,
          minWords: minWordsForContinuations,
        }) &&
        Date.now() < deadline
      ) {
        const secondBudget = Math.max(
          5_000,
          Math.min(deadline - Date.now() - 5_000, 30_000),
        );
        const resumed = await collectComments(reader, {
          postId: postRedditId,
          cap: hardCap,
          settleMs: options.settleMs,
          budgetMs: secondBudget,
          shouldStop,
        });
        if (resumed.comments.length > comments.length) {
          result = {
            ...resumed,
            renderedCount: baseResult.renderedCount,
            expandedCount: resumed.comments.length - baseResult.renderedCount,
          };
          comments = resumed.comments;
          inlineWords = comments.reduce(
            (total, comment) => total + countWords(comment.body),
            0,
          );
          this.logger.debug(
            {
              subreddit: subredditName,
              postId: postRedditId,
              softCap,
              returnedCount: comments.length,
              words: inlineWords,
            },
            'soft comment cap resumed for word guard',
          );
        }
      }
      if (
        !quotaStopped &&
        isPartialCommentRender({
          collected: comments.length,
          expected: expectedCommentCount,
          softCap,
        })
      ) {
        throw new Error(
          `reddit rendered only ${comments.length} of ${expectedCommentCount} comments`,
        );
      }
      let visibleLinksMs = 0;
      let links: {
        href: string;
        ownerId: string;
        depth?: number;
        more?: number;
      }[] = [];
      // A thread that already clears the word gate cannot need a continuation
      // page. Skip the expensive visible-anchor layout read entirely.
      if (inlineWords < minWordsForContinuations) {
        const visibleLookupStart = Date.now();
        const visibleLinks = await this.session
          .evaluateSafely<
            { href: string; ownerId: string; depth?: number; more?: number }[]
          >(page, findVisibleContinuationLinks)
          .catch((error) => {
            this.logger.debug(
              { error: String(error).slice(0, 160) },
              'visible continuation lookup failed',
            );
            return [];
          });
        visibleLinksMs = Date.now() - visibleLookupStart;
        links = Array.isArray(visibleLinks) ? visibleLinks : [];
        this.logger.debug(
          { found: links.length },
          'visible continuation lookup',
        );
      }
      let continuationPages = 0;
      let continuationAdded = 0;
      let continuationStoppedByWords = false;
      if (
        links.length > 0 &&
        inlineWords < minWordsForContinuations &&
        Date.now() < deadline
      ) {
        const merged: RedditCommentData[] = [];
        const visitedHrefs = new Set<string>();
        const continuation = await this.collectByHref(
          page,
          postRedditId,
          comments,
          merged,
          visitedHrefs,
          deadline,
          links,
          inlineWords,
          minWordsForContinuations,
        );
        continuationMs += continuation.elapsedMs;
        continuationStoppedByWords = continuation.stoppedByWords;
        continuationPages = continuation.pages;
        continuationAdded = continuation.added;
        if (merged.length > 0) {
          comments = finalizeComments(
            [...comments, ...merged],
            options.cap ?? 500,
            postRedditId,
          );
        }
      }

      const totalMs = Date.now() - startMs;
      const expansionMs = Math.max(0, totalMs - loadMs - continuationMs);

      this.logger.info(
        {
          subreddit: subredditName,
          postId: postRedditId,
          renderedCount: result.renderedCount,
          expandedCount: result.expandedCount,
          returnedCount: comments.length,
          loadMs,
          pageReadyMs,
          gotoMs,
          selectorMs,
          forbiddenMs,
          expansionMs,
          continuationMs,
          continuationPages,
          continuationAdded,
          continuationStoppedByWords,
          inlineWords,
          ms: totalMs,
          collectMs: result.timings?.totalMs ?? null,
          visibleLinksMs,
          profile: result.timings ?? null,
        },
        'comments collected',
      );

      return comments;
    });
  }
}
