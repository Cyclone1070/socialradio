import { Collection } from '@mikro-orm/core';
import { Post } from './post.entity';
import { Comment } from './comment.entity';
import { Subreddit } from './subreddit.entity';

describe('Post and Comment Entities Invariants & Encapsulation', () => {
  describe('Post', () => {
    it('encapsulates properties and enforces read-only scrapedAt and immutable fields', () => {
      const unpersisted = new Post();
      expect(unpersisted.scrapedAt).toBeUndefined();
      expect(unpersisted.comments.getItems()).toEqual([]);

      const sub = new Subreddit('news', 'sub-1');
      const redditCreatedAt = new Date('2026-09-10T12:00:00Z');
      const scrapedAt = new Date('2026-09-15T00:00:00Z');

      const post = new Post(
        sub,
        't3_abc',
        'Breaking News',
        'Article body',
        42,
        redditCreatedAt,
        scrapedAt,
        'post-1',
      );

      expect(post.id).toBe('post-1');
      expect(post.subreddit).toBe(sub);
      expect(post.subredditId).toBe('sub-1');
      expect(post.redditId).toBe('t3_abc');
      expect(post.title).toBe('Breaking News');
      expect(post.body).toBe('Article body');
      expect(post.score).toBe(42);
      expect(post.redditCreatedAt).toEqual(redditCreatedAt);
      expect(post.scrapedAt).toEqual(scrapedAt);

      // Score is mutable as upvotes change:
      post.score = 99;
      expect(post.score).toBe(99);
    });

    it('manages comments collection encapsulation and prevents direct setter exposure', () => {
      const post = new Post();
      expect(post.comments).toBeInstanceOf(Collection);
      expect(post.comments.getItems()).toEqual([]);
      expect(() => {
        // @ts-expect-error private setter
        post.comments = [];
      }).toThrow();
    });

    it('returns defensive copies of Date getters', () => {
      const redditCreatedAt = new Date('2026-09-10T12:00:00Z');
      const scrapedAt = new Date('2026-09-15T00:00:00Z');
      const post = new Post(
        undefined,
        't3_1',
        'Title',
        'Body',
        1,
        redditCreatedAt,
        scrapedAt,
      );

      const leakedReddit = post.redditCreatedAt;
      leakedReddit?.setTime(0);
      expect(post.redditCreatedAt?.toISOString()).toBe(
        '2026-09-10T12:00:00.000Z',
      );

      const leakedScraped = post.scrapedAt;
      leakedScraped?.setTime(0);
      expect(post.scrapedAt?.toISOString()).toBe('2026-09-15T00:00:00.000Z');
    });
  });

  describe('Comment', () => {
    it('encapsulates comment properties and enforces immutable fields', () => {
      const defaultComment = new Comment();
      expect(defaultComment.isOp).toBe(false);
      expect(defaultComment.parentRedditId).toBeNull();

      const post = new Post(
        undefined,
        't3_parent',
        'Title',
        'Body',
        5,
        undefined,
        undefined,
        'post-1',
      );
      const redditCreatedAt = new Date('2026-09-10T13:00:00Z');

      const comment = new Comment(
        post,
        't1_def',
        'Interesting comment',
        10,
        't1_parent',
        true,
        redditCreatedAt,
        'comment-1',
      );

      expect(comment.id).toBe('comment-1');
      expect(comment.post).toBe(post);
      expect(comment.postId).toBe('post-1');
      expect(comment.redditId).toBe('t1_def');
      expect(comment.body).toBe('Interesting comment');
      expect(comment.score).toBe(10);
      expect(comment.isOp).toBe(true);
      expect(comment.parentRedditId).toBe('t1_parent');
      expect(comment.redditCreatedAt).toEqual(redditCreatedAt);

      // Score is mutable as comment upvotes change:
      comment.score = 25;
      expect(comment.score).toBe(25);
    });

    it('returns defensive copies of redditCreatedAt', () => {
      const redditCreatedAt = new Date('2026-09-10T13:00:00Z');
      const comment = new Comment(
        undefined,
        't1_1',
        'Body',
        1,
        null,
        false,
        redditCreatedAt,
      );
      const leaked = comment.redditCreatedAt;
      leaked?.setTime(0);
      expect(comment.redditCreatedAt?.toISOString()).toBe(
        '2026-09-10T13:00:00.000Z',
      );
    });
  });
});
