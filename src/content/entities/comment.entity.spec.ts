import { Comment } from './comment.entity';
import { Post } from './post.entity';

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
      post.id,
      't1_def',
      'Interesting comment',
      10,
      't1_parent',
      true,
      redditCreatedAt,
      'comment-1',
    );

    expect(comment.id).toBe('comment-1');
    expect(comment.postId).toBe('post-1');
    expect(comment.redditId).toBe('t1_def');
    expect(comment.body).toBe('Interesting comment');
    expect(comment.score).toBe(10);
    expect(comment.isOp).toBe(true);
    expect(comment.parentRedditId).toBe('t1_parent');
    expect(comment.redditCreatedAt).toEqual(redditCreatedAt);
  });
});
