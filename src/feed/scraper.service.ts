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
    private readonly redditApiService: RedditScraperService,
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

    const rawPosts = await this.redditApiService.fetchTopPosts(
      subredditName,
      20,
    );
    const newPostEntities: Post[] = [];

    for (const rawPost of rawPosts) {
      const exists = await this.postRepo.findOneBy({ redditId: rawPost.id });
      if (exists) continue;

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

      const rawComments = await this.redditApiService.fetchPostComments(
        subredditName,
        rawPost.id,
        50,
      );
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
    return this.redditApiService.exists(subredditName);
  }
}
