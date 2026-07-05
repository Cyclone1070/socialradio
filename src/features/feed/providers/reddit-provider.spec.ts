import { RedditProvider } from './reddit-provider.service';

describe('RedditProvider', () => {
  let provider: RedditProvider;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    provider = new RedditProvider();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should fetch and parse a subreddit feed into FeedItems including OP and community comments', async () => {
    // 1. Mock listing API response (returns 1 post)
    const mockListingResponse = {
      data: {
        children: [
          {
            data: {
              id: 'post123',
              title: 'AI is changing everything',
              selftext: 'Here is some context about AI.',
              author: 'tech_guru',
              score: 500,
              num_comments: 10,
              permalink:
                '/r/technology/comments/post123/ai_is_changing_everything/',
            },
          },
        ],
      },
    };

    // 2. Mock detail API response (returns post + comments tree)
    const mockDetailResponse = [
      {}, // First element is post info (ignored since we already have it)
      {
        data: {
          children: [
            {
              data: {
                author: 'coder_bob',
                body: 'I agree, it is very helpful.',
                score: 150,
                is_submitter: false,
              },
            },
            {
              data: {
                author: 'tech_guru',
                body: 'Yes, exactly! That was my point.',
                score: 80,
                is_submitter: true, // OP reply!
              },
            },
            {
              data: {
                author: 'skeptic_alice',
                body: 'It is overhyped.',
                score: 2,
                is_submitter: false,
              },
            },
          ],
        },
      },
    ];

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockListingResponse),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDetailResponse),
      });

    const result = await provider.fetchFeed('technology', 1);

    // Assert fetch calls
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'https://www.reddit.com/r/technology.json?limit=1',
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://www.reddit.com/r/technology/comments/post123/ai_is_changing_everything.json',
    );

    // Assert parsed output
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'post123',
      title: 'AI is changing everything',
      content: 'Here is some context about AI.',
      community: 'r/technology',
      score: 500,
      commentsCount: 10,
      comments: [
        {
          content: 'I agree, it is very helpful.',
          role: 'community',
          score: 150,
        },
        {
          content: 'Yes, exactly! That was my point.',
          role: 'op',
          score: 80,
        },
        {
          content: 'It is overhyped.',
          role: 'community',
          score: 2,
        },
      ],
    });
  });

  it('should handle network failures gracefully by returning an empty array', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network Error'));

    const result = await provider.fetchFeed('technology', 1);

    expect(result).toEqual([]);
  });

  it('should handle bad HTTP responses gracefully by returning an empty array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const result = await provider.fetchFeed('technology', 1);

    expect(result).toEqual([]);
  });
});
