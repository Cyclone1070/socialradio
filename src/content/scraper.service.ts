import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import {
  EntityRepository,
  EntityManager,
  FilterQuery,
} from '@mikro-orm/postgresql';
import { randomUUID } from 'crypto';
import { Subreddit } from './entities/subreddit.entity';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';
import {
  SubredditSchema,
  PostSchema,
} from '../infrastructure/database/schemas/content.schema';
import { RedditScraperService } from './reddit-scraper.service';
import { createServiceLogger } from '../infrastructure/logging/logging.module';
import { isUniqueViolation } from '../infrastructure/database/errors';
import { ClaimStore, ScrapeLease } from './scrape-lease';

type FetchedPage = Awaited<ReturnType<RedditScraperService['fetchTopPosts']>>;
type FetchedPost = FetchedPage['posts'][number];
type FetchedComment = Awaited<
  ReturnType<RedditScraperService['fetchPostComments']>
>[number];

export interface ScrapeSubredditResult {
  scrapedPostsCount: number;
}

export { CLAIM_LEASE_MS, CLAIM_TICK_MS, RUN_CAP_MS } from './scrape-lease';

// Cooldown applied after a scrape that yielded 0 new posts
const SCRAPE_COOLDOWN_MS = 2 * 60 * 60 * 1000;

// One window knob: how old a scrape may be before the feed is stale, and
// how old posts must be before the retention purge drops them.
// (The fetcher serves a week of Reddit listings — t=week — so 7 days is
// exactly one pool: a stale sub re-scrapes the same window the purge kept.)
export const SCRAPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class ScraperService {
  constructor(
    @InjectRepository(SubredditSchema)
    private readonly subredditRepo: EntityRepository<Subreddit>,
    @InjectRepository(PostSchema)
    private readonly postRepo: EntityRepository<Post>,
    private readonly em: EntityManager,
    private readonly redditScraperService: RedditScraperService,
  ) {}

  private readonly logger = createServiceLogger(ScraperService.name);

  async scrapeSubreddit(
    subredditName: string,
    force = false,
  ): Promise<ScrapeSubredditResult> {
    // One id per run so every line of a walk is one grep.
    const scrapeId = randomUUID();
    const startMs = Date.now();

    const subreddit = await this.findOrCreateSubreddit(subredditName);
    const blocked = this.isScrapeBlocked(subreddit, force);
    if (blocked) {
      this.logger.warn(
        { sub: subredditName, reason: blocked },
        'scrape skipped',
      );
      return { scrapedPostsCount: 0 };
    }
    this.logger.info({ scrapeId, sub: subredditName }, 'scrape starting');
    // Claim it in one statement: whoever's UPDATE matches a row owns the run, so
    // two runs cannot both start. A claim is free, or stale by more than the lease
    // window - which is how a run that died without releasing gets taken over.
    const lease = await ScrapeLease.take(this.claimStore(), subreddit.id);
    if (!lease) {
      this.logger.warn(
        { scrapeId, sub: subredditName },
        'scrape skipped: another run holds the claim',
      );
      return { scrapedPostsCount: 0 };
    }
    lease.start((reason) => {
      this.logger.warn(
        { scrapeId, sub: subredditName, stopReason: reason },
        reason === 'time-cap'
          ? 'scrape reached its time cap - stopping after the current post'
          : 'claim taken by another run - stopping',
      );
    });

    try {
      let savedCount = 0;
      let pageCount = 0;
      let cursor: string | null = null;
      let prevFirstPostId: string | null = null;
      let stopReason = '';

      while (true) {
        let page;
        try {
          page = await this.redditScraperService.fetchTopPosts(subredditName, {
            limit: 100,
            ...(cursor ? { after: cursor } : {}),
          });
        } catch (err) {
          stopReason = 'fetch-fail';
          this.logger.error(
            {
              scrapeId,
              sub: subredditName,
              page: pageCount + 1,
              cursor,
              stopReason,
              err: err instanceof Error ? err : new Error(String(err)),
            },
            'page fetch failed — stopping the walk',
          );
          break;
        }
        pageCount++;
        const { posts: rawPosts, isInvalid, after } = page;
        if (isInvalid) {
          stopReason = 'is-invalid';
          this.logger.warn(
            { scrapeId, sub: subredditName, stopReason },
            'subreddit invalid — deleting row',
          );
          await this.subredditRepo.nativeDelete({ id: subreddit.id });
          return { scrapedPostsCount: 0 };
        }
        this.logger.debug(
          {
            scrapeId,
            sub: subredditName,
            page: pageCount,
            cursor,
            viable: rawPosts.length,
            saved: savedCount,
          },
          'walk page fetched',
        );

        for (const rawPost of rawPosts) {
          if (lease.shouldStop) {
            stopReason = lease.stopReason ?? 'claim-lost';
            break;
          }
          if (savedCount >= 20) {
            stopReason = 'saved-20';
            break;
          }

          const exists = await this.postRepo.findOne({
            redditId: rawPost.id,
          });
          if (exists) {
            this.logger.debug(
              { scrapeId, sub: subredditName, postId: rawPost.id },
              'post already in DB — dedup skip',
            );
            continue;
          }

          let rawComments;
          try {
            rawComments = await this.redditScraperService.fetchPostComments(
              subredditName,
              rawPost.id,
            );
          } catch (err) {
            this.logger.warn(
              {
                scrapeId,
                sub: subredditName,
                postId: rawPost.id,
                err: err instanceof Error ? err.message : String(err),
              },
              'failed to fetch post comments — skipping post',
            );
            continue;
          }

          // Word count guard: total words across all comments must be >= 2500
          const totalWords = rawComments.reduce((sum, c) => {
            const body = c.body || '';
            return sum + body.split(/\s+/).filter(Boolean).length;
          }, 0);

          if (totalWords < 2500) {
            this.logger.debug(
              {
                scrapeId,
                sub: subredditName,
                postId: rawPost.id,
                words: totalWords,
                threshold: 2500,
              },
              'post below word guard',
            );
            continue;
          }

          const stored = await this.storePostWithComments(
            subreddit.id,
            rawPost,
            rawComments,
          );
          if (!stored) continue;
          savedCount++;
        }

        const firstPostId = rawPosts[0]?.id ?? null;
        if (firstPostId !== null && firstPostId === prevFirstPostId) {
          stopReason = 'cursor-loop-guard';
          break;
        }
        prevFirstPostId = firstPostId;

        if (savedCount >= 20 || !after) {
          stopReason =
            stopReason || (savedCount >= 20 ? 'saved-20' : 'pool-exhausted');
          break;
        }
        cursor = after;
      }

      await this.cleanupOldData(subreddit.id);

      subreddit.lastScrapedAt = new Date();
      if (savedCount === 0) {
        subreddit.scrapeCooldownUntil = new Date(
          Date.now() + SCRAPE_COOLDOWN_MS,
        );
      }
      await this.em.flush();

      this.logger.info(
        {
          scrapeId,
          sub: subredditName,
          saved: savedCount,
          pages: pageCount,
          durationMs: Date.now() - startMs,
          stopReason,
        },
        'scrape walk finished',
      );

      return { scrapedPostsCount: savedCount };
    } finally {
      // Ownership-scoped: if another run has already taken over, this clears
      // nothing and that run keeps its claim. A deleted row makes it a no-op.
      await lease.stop();
    }
  }

  /**
   * A post and its comments are one unit. A post stored without them is worthless
   * material, and since every later scrape skips a post it already has, it would
   * stay empty forever - so both rows commit together or neither does.
   *
   * Returns false when another run stored the same post first: losing that race
   * should cost one post, not the whole walk.
   */
  private async storePostWithComments(
    subredditId: string,
    rawPost: FetchedPost,
    rawComments: FetchedComment[],
  ): Promise<boolean> {
    try {
      await this.em.transactional(async (em) => {
        const post = new Post(
          subredditId,
          rawPost.id,
          rawPost.title,
          rawPost.selftext || '',
          rawPost.score,
          new Date(rawPost.created_utc * 1000),
        );
        em.persist(post);
        // Flushed inside the transaction: the comments need the generated id,
        // and nothing is visible to anyone else until the unit commits.
        await em.flush();

        const comments = rawComments.map((rawComment) => {
          const isOp = rawComment.author === rawPost.author;
          const parentIdStr = String(rawComment.parent_id || '');
          const parentRedditId =
            parentIdStr &&
            parentIdStr !== rawPost.id &&
            !parentIdStr.startsWith('t3_')
              ? parentIdStr.replace(/^t1_/, '')
              : null;

          return new Comment(
            post.id,
            rawComment.id,
            rawComment.body || '',
            rawComment.score || 0,
            parentRedditId,
            isOp,
            new Date((rawComment.created_utc || 0) * 1000),
          );
        });

        // Idempotent rather than merely new-row-shaped: a re-fetch after a dead
        // browser, or two runs overlapping, would otherwise trip the unique index
        // on comment.reddit_id and take the whole walk down with it. On conflict
        // only the fields a re-scrape legitimately changes are refreshed -
        // post_id is deliberately absent, since a comment id is unique site-wide
        // and merging it would move a comment onto whichever post reported it last.
        await em.upsertMany(Comment, comments, {
          onConflictFields: ['redditId'],
          onConflictAction: 'merge',
          onConflictMergeFields: ['score', 'body'],
        });
      });
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) {
        this.logger.debug(
          { subredditId, postId: rawPost.id },
          'another run stored this post first - skipping it',
        );
        return false;
      }
      throw err;
    }
  }

  /**
   * The row may not exist yet, and two runs can reach that moment together. So the
   * write has to tolerate losing it: whoever arrives first creates the row, and the
   * loser reads theirs back and carries on. What decides who actually walks is the
   * claim taken next, not who won the insert.
   *
   * Lookups use the name the row is stored under - the setter trims and lowercases -
   * because searching for the raw input would miss an existing row and then collide
   * with it on insert.
   */
  private async findOrCreateSubreddit(name: string): Promise<Subreddit> {
    const seed = new Subreddit();
    seed.name = name;
    const criteria = { name: seed.name };

    const existing = await this.subredditRepo.findOne(criteria);
    if (existing) return existing;

    await this.em.upsert(Subreddit, criteria, {
      onConflictFields: ['name'],
      onConflictAction: 'ignore',
    });

    const row = await this.subredditRepo.findOne(criteria);
    if (!row) {
      throw new Error(
        `subreddit ${seed.name} vanished between writing and reading it back`,
      );
    }
    return row;
  }

  /**
   * The lease's three statements, expressed as repo calls so the lease itself knows
   * nothing about the ORM. A renewal failure is logged here, where the logger lives,
   * and then rethrown: the lease decides what a missed beat means.
   */
  private claimStore(): ClaimStore {
    return {
      take: (subredditId, token, staleBefore) =>
        this.subredditRepo.nativeUpdate(
          {
            id: subredditId,
            $or: [
              { scrapeStartedAt: null },
              { scrapeStartedAt: { $lt: staleBefore } },
            ],
          },
          { scrapeStartedAt: new Date(), scrapeClaimId: token },
        ),
      renew: async (subredditId, token, at) => {
        try {
          return await this.subredditRepo.nativeUpdate(
            { id: subredditId, scrapeClaimId: token },
            { scrapeStartedAt: at },
          );
        } catch (err: unknown) {
          this.logger.warn(
            { err },
            'claim renewal failed - retrying on the next beat',
          );
          throw err;
        }
      },
      release: async (subredditId, token) => {
        await this.subredditRepo.nativeUpdate(
          { id: subredditId, scrapeClaimId: token },
          { scrapeStartedAt: null, scrapeClaimId: null },
        );
      },
    };
  }

  private isScrapeBlocked(
    subreddit: Subreddit | null,
    force: boolean,
  ): string | null {
    if (force || !subreddit) return null;
    if (
      subreddit.scrapeCooldownUntil &&
      subreddit.scrapeCooldownUntil.getTime() > Date.now()
    ) {
      return 'cooldown';
    }
    return null;
  }

  async cleanupOldData(subredditId?: string): Promise<void> {
    const cutoff = new Date(Date.now() - SCRAPE_WINDOW_MS);
    const where: FilterQuery<Post> = { scrapedAt: { $lt: cutoff } };
    if (subredditId) {
      where.subredditId = subredditId;
    }
    const count = await this.postRepo.nativeDelete(where);
    this.logger.info(
      {
        scope: subredditId ?? 'all',
        cutoffAgeDays: SCRAPE_WINDOW_MS / (24 * 60 * 60 * 1000),
        deletedCount: count,
      },
      'purged old posts',
    );
  }

  async validateSubreddit(subredditName: string): Promise<boolean> {
    return this.redditScraperService.exists(subredditName);
  }
}
