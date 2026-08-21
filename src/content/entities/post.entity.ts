import { Subreddit } from './subreddit.entity';
import { Comment } from './comment.entity';

export class Post {
  id!: string;
  subredditId!: string;
  subreddit?: Subreddit;
  redditId!: string;
  title!: string;
  body!: string;
  score!: number;
  redditCreatedAt!: Date;
  scrapedAt: Date = new Date();
  comments: Comment[] = [];
}
