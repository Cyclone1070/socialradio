import { PostData } from '../../domain';
import { clusterPosts } from './topic-clustering.util';

describe('TopicClustering Utility', () => {
  describe('clusterPosts', () => {
    it('should sort posts by score descending and assign topics', () => {
      const post1: PostData = {
        id: 'p1',
        subredditId: 'sub-1',
        redditId: 'r1',
        title: 'SpaceX Falcon Heavy launch',
        body: 'body 1',
        score: 100,
      };
      const post2: PostData = {
        id: 'p2',
        subredditId: 'sub-1',
        redditId: 'r2',
        title: 'SpaceX launch of Falcon Heavy delayed',
        body: 'body 2',
        score: 80,
      };

      const topics = clusterPosts([post2, post1]);

      expect(topics).toHaveLength(2);
      expect(topics[0].id).toBe('topic-p1');
      expect(topics[0].name).toBe('SpaceX Falcon Heavy launch');
      expect(topics[0].posts[0].id).toBe('p1');
    });

    it('should return empty array for empty input', () => {
      expect(clusterPosts([])).toEqual([]);
    });
  });
});
