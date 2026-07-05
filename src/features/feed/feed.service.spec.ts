import { FeedService } from './feed.service';
import { FeedProvider } from './interfaces/feed-provider.interface';

describe('FeedService', () => {
  let service: FeedService;
  let mockRedditProvider: jest.Mocked<FeedProvider>;

  beforeEach(() => {
    mockRedditProvider = {
      fetchFeed: jest.fn(),
    };

    service = new FeedService(mockRedditProvider);
  });

  it('should delegate fetching to the RedditProvider when source is reddit', async () => {
    const mockFeedItems = [
      {
        id: '1',
        title: 'Tech News',
        score: 100,
        commentsCount: 5,
        comments: [],
      },
    ];
    mockRedditProvider.fetchFeed.mockResolvedValueOnce(mockFeedItems);

    const result = await service.fetchFeed('reddit', 'technology', 3);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(mockRedditProvider.fetchFeed).toHaveBeenCalledWith('technology', 3);
    expect(result).toEqual(mockFeedItems);
  });

  it('should throw an error for unsupported sources', async () => {
    await expect(
      service.fetchFeed('unsupported_source' as unknown as 'reddit', 'tech'),
    ).rejects.toThrow('Unsupported feed source: unsupported_source');
  });
});
