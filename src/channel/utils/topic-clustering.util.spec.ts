import { PostData } from '../../domain';
import { clusterPosts } from './topic-clustering.util';

describe('TopicClustering Utility', () => {
  describe('clusterPosts', () => {
    it('should group similar posts into topics and sort by score descending', () => {
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
      const post3: PostData = {
        id: 'p3',
        subredditId: 'sub-1',
        redditId: 'r3',
        title: 'How to make pasta tonight',
        body: 'body 3',
        score: 50,
      };

      const topics = clusterPosts([post3, post2, post1]);

      expect(topics).toHaveLength(2);
      expect(topics[0].id).toBe('p1');
      expect(topics[0].name).toBe('SpaceX Falcon Heavy launch');
      expect(topics[0].posts).toHaveLength(2);
      expect(topics[0].posts[0].id).toBe('p1');
      expect(topics[0].posts[1].id).toBe('p2');

      expect(topics[1].id).toBe('p3');
      expect(topics[1].posts).toHaveLength(1);
    });

    it('should return empty array for empty input', () => {
      expect(clusterPosts([])).toEqual([]);
    });
  });
});
