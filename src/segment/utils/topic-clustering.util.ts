import { PostData } from '../../domain';
import { Topic } from '../interfaces/topic.interface';

export function clusterPosts(posts: PostData[]): Topic[] {
  if (!posts || posts.length === 0) return [];
  const sorted = [...posts].sort((a, b) => b.score - a.score);
  return sorted.map((p, idx) => ({
    id: `topic-${p.id}`,
    name: p.title,
    posts: [p],
    score: p.score + (sorted.length - idx),
  }));
}
