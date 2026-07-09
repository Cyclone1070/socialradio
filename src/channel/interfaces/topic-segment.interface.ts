import { Post } from '../../feed/entities/post.entity';

export interface TopicSegment {
  id: string; // The primary post's database ID
  title: string; // The primary post's title
  posts: Post[]; // Grouped posts in this topic segment (primary post + similar posts)
}
