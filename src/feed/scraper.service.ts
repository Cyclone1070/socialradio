import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Subreddit } from '../domain/entities/subreddit.entity';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';
import { RedditScraperService } from './reddit-scraper.service';

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

  async scrapeSubreddit(subredditName: string): Promise<void> {
    await this.cleanupOldData();

    let subreddit = await this.subredditRepo.findOneBy({ name: subredditName });
    if (!subreddit) {
      subreddit = this.subredditRepo.create({ name: subredditName });
      subreddit = await this.subredditRepo.save(subreddit);
    }

    // Gracefully delete and exit if subreddit is private, banned, or non-existent
    const isValid = await this.validateSubreddit(subredditName);
    if (!isValid) {
      await this.subredditRepo.delete({ id: subreddit.id });
      return;
    }

    const rawPosts = await this.redditScraperService.fetchTopPosts(
      subredditName,
      100,
    );
    const newPostEntities: Post[] = [];
    let savedCount = 0;

    for (const rawPost of rawPosts) {
      if (savedCount >= 20) {
        break;
      }

      const exists = await this.postRepo.findOneBy({ redditId: rawPost.id });
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

      newPostEntities.push(savedPost);
      savedCount++;
    }

    subreddit.lastScrapedAt = new Date();
    await this.subredditRepo.save(subreddit);
  }

  async cleanupOldData(): Promise<void> {
    const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000);
    // Deleting posts cascadedly deletes their comments
    await this.postRepo.delete({ scrapedAt: LessThan(cutoff) });
  }

  async validateSubreddit(subredditName: string): Promise<boolean> {
    return this.redditScraperService.exists(subredditName);
  }
}
