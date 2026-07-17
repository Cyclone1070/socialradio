import { Post } from '../../feed/entities/post.entity';

export interface Topic {
  id: string; // The primary post's database ID
  posts: Post[]; // Grouped posts in this topic (primary post + similar posts)
}
