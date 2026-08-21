import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import { Subreddit } from './entities/subreddit.entity';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';
import {
  SubredditSchema,
  PostSchema,
  CommentSchema,
} from '../infrastructure/database/schemas/content.schema';
import { ScraperService } from './scraper.service';
import { ContentContract } from '../domain/contracts';
import { PostData, CommentData } from '../domain/types/post.types';
import { SubredditData } from '../domain/types/subreddit.types';

@Injectable()
export class ContentService implements ContentContract {
  constructor(
    @InjectRepository(SubredditSchema)
    private readonly subredditRepo: EntityRepository<Subreddit>,
    @InjectRepository(PostSchema)
    private readonly postRepo: EntityRepository<Post>,
    @InjectRepository(CommentSchema)
    private readonly commentRepo: EntityRepository<Comment>,
    private readonly scraperService: ScraperService,
  ) {}

  async getPostData(postId: string): Promise<PostData | null> {
    const post = await this.postRepo.findOne(
      { id: postId },
      { populate: ['subreddit'] },
    );
    if (!post) return null;
    return {
      id: post.id,
      subredditId: post.subreddit?.id || post.subredditId,
      redditId: post.redditId,
      title: post.title,
      body: post.body,
      score: post.score,
    };
  }

  async getPostsBySubredditIds(subredditIds: string[]): Promise<PostData[]> {
    if (subredditIds.length === 0) return [];
    const posts = await this.postRepo.find(
      { subreddit: { id: { $in: subredditIds } } },
      { populate: ['subreddit'] },
    );
    return posts.map((post) => ({
      id: post.id,
      subredditId: post.subreddit?.id || post.subredditId,
      redditId: post.redditId,
      title: post.title,
      body: post.body,
      score: post.score,
    }));
  }

  async getCommentsByPostIds(postIds: string[]): Promise<CommentData[]> {
    if (postIds.length === 0) return [];
    const comments = await this.commentRepo.find(
      { post: { id: { $in: postIds } } },
      { populate: ['post'] },
    );
    return comments.map((c) => ({
      id: c.id,
      postId: c.post?.id || c.postId,
      redditId: c.redditId,
      body: c.body,
      score: c.score,
      parentRedditId: c.parentRedditId,
      isOp: c.isOp,
    }));
  }

  async getSubredditsByIds(ids: string[]): Promise<SubredditData[]> {
    if (ids.length === 0) return [];
    const subs = await this.subredditRepo.find({ id: { $in: ids } });
    return subs.map((s) => ({
      id: s.id,
      name: s.name,
      lastScrapedAt: s.lastScrapedAt,
      createdAt: s.createdAt,
    }));
  }

  async getSubredditByName(name: string): Promise<SubredditData | null> {
    const sub = await this.subredditRepo.findOne({ name });
    if (!sub) return null;
    return {
      id: sub.id,
      name: sub.name,
      lastScrapedAt: sub.lastScrapedAt,
      createdAt: sub.createdAt,
    };
  }

  async scrapeSubreddit(subredditName: string): Promise<void> {
    await this.scraperService.scrapeSubreddit(subredditName);
  }
}
