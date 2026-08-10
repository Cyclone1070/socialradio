import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Subreddit } from '../domain/entities/subreddit.entity';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';
import { RedditScraperService } from './reddit-scraper.service';

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
    @InjectRepository(Subreddit)
    private readonly subredditRepo: Repository<Subreddit>,
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
    private readonly redditScraperService: RedditScraperService,
  ) {}

  async scrapeSubreddit(
    subredditName: string,
    force = false,
  ): Promise<ScrapeSubredditResult> {
    // Claim the subreddit to dedupe concurrent scrapes (multi-instance safe).
    // Stale claims older than 30min are considered abandoned (TTL reclaim).
    let subreddit = await this.subredditRepo.findOneBy({ name: subredditName });
    if (this.isScrapeBlocked(subreddit, force)) {
      return { scrapedPostsCount: 0 }; // in-flight or cooling down
    }
    if (!subreddit) {
      subreddit = this.subredditRepo.create({ name: subredditName });
      subreddit = await this.subredditRepo.save(subreddit);
    }
    subreddit.scrapeStartedAt = new Date();
    await this.subredditRepo.save(subreddit);

    // True once the row has been deleted (isInvalid): never save again —
    // TypeORM save() on the deleted entity would re-INSERT the row.
    let deleted = false;

    try {
      // The walk: page by page, evaluating every stop condition as we go.
      // The moment 20 posts are saved the loop halts — remaining posts on
      // the page are never visited, no further pages are fetched.
      let savedCount = 0;
      let cursor: string | null = null;
      let prevFirstPostId: string | null = null;

      while (true) {
        // A failed page fetch (!ok from the fetcher: 403/429/network after
        // its in-page retries) stops the walk quietly — partials are kept
        // and the subreddit row survives. Only isInvalid deletes.
        let page;
        try {
          page = await this.redditScraperService.fetchTopPosts(subredditName, {
            limit: 100,
            ...(cursor ? { after: cursor } : {}),
          });
        } catch {
          break;
        }
        const { posts: rawPosts, isInvalid, after } = page;
        if (isInvalid) {
          deleted = true;
          await this.subredditRepo.delete({ id: subreddit.id });
          return { scrapedPostsCount: 0 };
        }

        for (const rawPost of rawPosts) {
          if (savedCount >= 20) {
            break;
          }

          const exists = await this.postRepo.findOneBy({
            redditId: rawPost.id,
          });
          if (exists) continue;

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
            continue;
          }

          const post = this.postRepo.create({
            subredditId: subreddit.id,
            redditId: rawPost.id,
            title: rawPost.title,
            body: rawPost.selftext || '',
            score: rawPost.score,
            redditCreatedAt: new Date(rawPost.created_utc * 1000),
          });

          // Save post first so comments can reference its ID via database relation
          const savedPost = await this.postRepo.save(post);

          const comments = rawComments.map((rawComment) => {
            const isOp = rawComment.author === rawPost.author;
            const parentRedditId = rawComment.parent_id.startsWith('t1_')
              ? rawComment.parent_id.replace('t1_', '')
              : null;

            return this.commentRepo.create({
              postId: savedPost.id,
              redditId: rawComment.id,
              body: rawComment.body,
              score: rawComment.score,
              parentRedditId,
              isOp,
              redditCreatedAt: new Date(rawComment.created_utc * 1000),
            });
          });
          await this.commentRepo.save(comments);

          savedCount++;
        }

        // Belt + braces: Reddit's cursor never loops, but a pathological
        // page repeating the previous page's first post id ends the walk.
        const firstPostId = rawPosts[0]?.id ?? null;
        if (firstPostId !== null && firstPostId === prevFirstPostId) {
          break;
        }
        prevFirstPostId = firstPostId;

        // Stop when the job is done (20 saved) or the pool is exhausted
        // (no cursor back from the fetcher).
        if (savedCount >= 20 || !after) {
          break;
        }
        cursor = after;
      }

      // Purge this sub's posts older than 72h AFTER saving new ones, so new
      // content is persisted before any cleanup runs (no availability gap).
      await this.cleanupOldData(subreddit.id);

      subreddit.lastScrapedAt = new Date();
      if (savedCount === 0) {
        subreddit.scrapeCooldownUntil = new Date(
          Date.now() + SCRAPE_COOLDOWN_MS,
        );
      }
      await this.subredditRepo.save(subreddit);

      return { scrapedPostsCount: savedCount };
    } finally {
      // Release the claim so future scrapes can run — but never save a
      // deleted entity back (it would resurrect the row).
      if (!deleted) {
        subreddit.scrapeStartedAt = null;
        await this.subredditRepo.save(subreddit);
      }
    }
  }

  /**
   * Whether a scrape should be skipped: an in-flight claim (TTL-bounded) or a
   * cooldown after a 0-new-post scrape. `force` bypasses both.
   */
  private isScrapeBlocked(
    subreddit: Subreddit | null,
    force: boolean,
  ): boolean {
    if (force || !subreddit) return false;
    if (
      subreddit.scrapeStartedAt &&
      Date.now() - subreddit.scrapeStartedAt.getTime() < CLAIM_TTL_MS
    ) {
      return true;
    }
    return (
      !!subreddit.scrapeCooldownUntil &&
      subreddit.scrapeCooldownUntil.getTime() > Date.now()
    );
  }

  async cleanupOldData(subredditId?: string): Promise<void> {
    const cutoff = new Date(Date.now() - SCRAPE_WINDOW_MS);
    // Deleting posts cascadedly deletes their comments
    await this.postRepo.delete({
      ...(subredditId ? { subredditId } : {}),
      scrapedAt: LessThan(cutoff),
    });
  }

  async validateSubreddit(subredditName: string): Promise<boolean> {
    return this.redditScraperService.exists(subredditName);
  }
}
