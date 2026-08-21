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

export interface ScrapeSubredditResult {
  scrapedPostsCount: number;
}

// TTL for an in-flight scrape claim: claims older than this are abandoned
const CLAIM_TTL_MS = 30 * 60 * 1000;

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

    // Claim the subreddit to dedupe concurrent scrapes (multi-instance safe).
    // Stale claims older than 30min are considered abandoned (TTL reclaim).
    let subreddit = await this.subredditRepo.findOne({ name: subredditName });
    const blocked = this.isScrapeBlocked(subreddit, force);
    if (blocked) {
      this.logger.warn(
        { sub: subredditName, reason: blocked },
        'scrape skipped',
      );
      return { scrapedPostsCount: 0 };
    }
    this.logger.info({ scrapeId, sub: subredditName }, 'scrape starting');
    if (!subreddit) {
      subreddit = new Subreddit();
      subreddit.name = subredditName;
      await this.em.persist(subreddit).flush();
    }
    subreddit.scrapeStartedAt = new Date();
    await this.em.flush();

    let deleted = false;

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
          deleted = true;
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

          const rawComments = await this.redditScraperService.fetchPostComments(
            subredditName,
            rawPost.id,
          );

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

          const post = new Post();
          post.subreddit = subreddit;
          post.redditId = rawPost.id;
          post.title = rawPost.title;
          post.body = rawPost.selftext || '';
          post.score = rawPost.score;
          post.redditCreatedAt = new Date(rawPost.created_utc * 1000);
          this.em.persist(post);

          for (const rawComment of rawComments) {
            const isOp = rawComment.author === rawPost.author;
            const parentRedditId = rawComment.parent_id.startsWith('t1_')
              ? rawComment.parent_id.replace('t1_', '')
              : null;

            const comment = new Comment();
            comment.post = post;
            comment.redditId = rawComment.id;
            comment.body = rawComment.body;
            comment.score = rawComment.score;
            comment.parentRedditId = parentRedditId;
            comment.isOp = isOp;
            comment.redditCreatedAt = new Date(rawComment.created_utc * 1000);
            this.em.persist(comment);
          }
          await this.em.flush();

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
      if (!deleted) {
        subreddit.scrapeStartedAt = null;
        await this.em.flush();
      }
    }
  }

  private isScrapeBlocked(
    subreddit: Subreddit | null,
    force: boolean,
  ): string | null {
    if (force || !subreddit) return null;
    if (
      subreddit.scrapeStartedAt &&
      Date.now() - subreddit.scrapeStartedAt.getTime() < CLAIM_TTL_MS
    ) {
      return 'in-flight claim';
    }
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
      where.subreddit = subredditId;
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
