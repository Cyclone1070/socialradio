import {
  parseFetcherPayload,
  RedditFetcherContractError,
  topPostsResponseSchema,
} from './reddit-fetcher.dto';

const page = {
  posts: [
    {
      id: 'abc123',
      title: 'A title',
      selftext: 'A body',
      author: 'someone',
      score: 42,
      created_utc: 1_790_000_000,
      permalink: '/r/x/comments/abc123/a_title/',
    },
  ],
  after: null,
  isInvalid: false,
};

describe('reddit fetcher contract', () => {
  it('accepts a payload that satisfies the contract, including fields we do not use', () => {
    const parsed = parseFetcherPayload(
      topPostsResponseSchema,
      page,
      '/top-posts/x',
    );

    expect(parsed.posts).toHaveLength(1);
    expect(parsed.posts[0].id).toBe('abc123');
    expect(parsed.isInvalid).toBe(false);
  });

  it('rejects a payload whose required field was renamed, and names the field', () => {
    const renamed = {
      posts: [
        {
          id: 'abc123',
          titleText: 'A title',
          selftext: 'A body',
          author: 'someone',
          score: 42,
          created_utc: 1_790_000_000,
        },
      ],
      after: null,
      isInvalid: false,
    };

    expect(() =>
      parseFetcherPayload(topPostsResponseSchema, renamed, '/top-posts/x'),
    ).toThrow(RedditFetcherContractError);

    expect(() =>
      parseFetcherPayload(topPostsResponseSchema, renamed, '/top-posts/x'),
    ).toThrow(/posts\.0\.title/);
  });
});
