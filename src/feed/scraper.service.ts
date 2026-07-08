import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Subreddit } from '../domain/entities/subreddit.entity';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';
import { Topic } from '../domain/entities/topic.entity';
import { RedditApiService } from './reddit-api.service';
import { TopicService } from './topic.service';

@Injectable()
export class ScraperService {
  constructor(
    @InjectRepository(Subreddit)
    private readonly subredditRepo: Repository<Subreddit>,
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
    @InjectRepository(Topic)
    private readonly topicRepo: Repository<Topic>,
    private readonly redditApiService: RedditApiService,
    private readonly topicService: TopicService,
  ) {}

  async scrapeSubreddit(subredditName: string): Promise<void> {
    let subreddit = await this.subredditRepo.findOneBy({ name: subredditName });
    if (!subreddit) {
      subreddit = this.subredditRepo.create({ name: subredditName });
      subreddit = await this.subredditRepo.save(subreddit);
    }

    const rawPosts = await this.redditApiService.fetchTopPosts(subredditName, 10);
    const newPostEntities: Post[] = [];

    for (const rawPost of rawPosts) {
      const exists = await this.postRepo.findOneBy({ redditId: rawPost.id });
      if (exists) continue;

      const post = this.postRepo.create({
        subredditId: subreddit.id,
        redditId: rawPost.id,
        title: rawPost.title,
        body: rawPost.selftext || '',
        author: rawPost.author,
        score: rawPost.score,
        commentCount: rawPost.num_comments,
        permalink: rawPost.permalink,
        redditCreatedAt: new Date(rawPost.created_utc * 1000),
      });

      // Save post first so comments can reference its ID via database relation
      const savedPost = await this.postRepo.save(post);

      const rawComments = await this.redditApiService.fetchPostComments(subredditName, rawPost.id, 5);
      const comments = rawComments.map(rawComment => 
        this.commentRepo.create({
          postId: savedPost.id,
          redditId: rawComment.id,
          body: rawComment.body,
          author: rawComment.author,
          score: rawComment.score,
          parentCommentId: null, // depth=1 flat structure
          redditCreatedAt: new Date(rawComment.created_utc * 1000),
        })
      );
      await this.commentRepo.save(comments);

      newPostEntities.push(savedPost);
    }

    if (newPostEntities.length > 0) {
      await this.topicService.categorizeNewPosts(subreddit.id, newPostEntities);
    }

    subreddit.lastScrapedAt = new Date();
    await this.subredditRepo.save(subreddit);
  }

  async cleanupOldData(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // Deleting posts cascadedly deletes their comments
    await this.postRepo.delete({ scrapedAt: LessThan(cutoff) });
    // Delete topics that haven't been updated in 24 hours
    await this.topicRepo.delete({ updatedAt: LessThan(cutoff) });
  }
}
