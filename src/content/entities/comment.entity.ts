import { Post } from './post.entity';

export class Comment {
  id!: string;
  postId!: string;
  post?: Post;
  redditId!: string;
  body!: string;
  score!: number;
  parentRedditId: string | null = null;
  isOp: boolean = false;
  redditCreatedAt!: Date;
}
