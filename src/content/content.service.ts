import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Subreddit } from './entities/subreddit.entity';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';
import { ScraperService } from './scraper.service';
import { ContentContract } from '../domain/contracts';
import { PostData, CommentData } from '../domain/types/post.types';
import { SubredditData } from '../domain/types/subreddit.types';

@Injectable()
export class ContentService implements ContentContract {
  constructor(
    @InjectRepository(Subreddit)
    private readonly subredditRepo: Repository<Subreddit>,
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
    private readonly scraperService: ScraperService,
  ) {}

  async getPostData(postId: string): Promise<PostData | null> {
    const post = await this.postRepo.findOne({ where: { id: postId } });
    if (!post) return null;
    return {
      id: post.id,
      subredditId: post.subredditId,
      redditId: post.redditId,
      title: post.title,
      body: post.body,
      score: post.score,
    };
  }

  async getPostsBySubredditIds(subredditIds: string[]): Promise<PostData[]> {
    if (subredditIds.length === 0) return [];
    const posts = await this.postRepo.find({
      where: { subredditId: In(subredditIds) },
    });
    return posts.map((post) => ({
      id: post.id,
      subredditId: post.subredditId,
      redditId: post.redditId,
      title: post.title,
      body: post.body,
      score: post.score,
    }));
  }

  async getCommentsByPostIds(postIds: string[]): Promise<CommentData[]> {
    if (postIds.length === 0) return [];
    const comments = await this.commentRepo.find({
      where: { postId: In(postIds) },
    });
    return comments.map((c) => ({
      id: c.id,
      postId: c.postId,
      redditId: c.redditId,
      body: c.body,
      score: c.score,
      parentRedditId: c.parentRedditId,
      isOp: c.isOp,
    }));
  }

  async getSubredditsByIds(ids: string[]): Promise<SubredditData[]> {
    if (ids.length === 0) return [];
    const subs = await this.subredditRepo.find({
      where: { id: In(ids) },
    });
    return subs.map((s) => ({
      id: s.id,
      name: s.name,
      lastScrapedAt: s.lastScrapedAt,
      createdAt: s.createdAt,
    }));
  }

  async getSubredditByName(name: string): Promise<SubredditData | null> {
    const sub = await this.subredditRepo.findOne({ where: { name } });
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
