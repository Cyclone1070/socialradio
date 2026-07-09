import { Post } from '../../feed/entities/post.entity';
import {
  clusterPosts,
  jaccardSimilarity,
  tokenize,
} from './topic-clustering.util';

describe('TopicClustering Utility', () => {
  describe('tokenize', () => {
    it('should split keywords and remove stop words and punctuation', () => {
      const title = 'The SpaceX Falcon Heavy launch is delayed!';
      const tokens = tokenize(title);
      expect(tokens.has('spacex')).toBe(true);
      expect(tokens.has('falcon')).toBe(true);
      expect(tokens.has('heavy')).toBe(true);
      expect(tokens.has('delayed')).toBe(true);
      expect(tokens.has('the')).toBe(false);
      expect(tokens.has('is')).toBe(false);
    });
  });

  describe('jaccardSimilarity', () => {
    it('should compute jaccard coefficient correctly', () => {
      const setA = new Set(['spacex', 'falcon', 'heavy']);
      const setB = new Set(['spacex', 'falcon', 'heavy', 'delayed']);
      // intersection = 3, union = 4
      expect(jaccardSimilarity(setA, setB)).toBe(0.75);
    });

    it('should return 0 if one set is empty', () => {
      expect(jaccardSimilarity(new Set(), new Set(['a']))).toBe(0);
    });
  });

  describe('clusterPosts', () => {
    it('should group similar posts and sort by score descending', () => {
      const post1 = {
        id: 'p1',
        title: 'SpaceX Falcon Heavy launch',
        score: 100,
      } as Post;
      const post2 = {
        id: 'p2',
        title: 'SpaceX launch of Falcon Heavy delayed',
        score: 80,
      } as Post;
      const post3 = {
        id: 'p3',
        title: 'How to make pasta tonight',
        score: 50,
      } as Post;

      const segments = clusterPosts([post3, post2, post1]);

      expect(segments).toHaveLength(2);
      // Segment 1 (SpaceX cluster)
      expect(segments[0].id).toBe('p1'); // Centroid should be highest score (p1)
      expect(segments[0].posts).toHaveLength(2);
      expect(segments[0].posts[0].id).toBe('p1');
      expect(segments[0].posts[1].id).toBe('p2');

      // Segment 2 (pasta cluster)
      expect(segments[1].id).toBe('p3');
      expect(segments[1].posts).toHaveLength(1);
    });
  });
});
