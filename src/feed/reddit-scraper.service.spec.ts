import { RedditScraperService } from './reddit-scraper.service';
import { ConfigService } from '@nestjs/config';

describe('RedditScraperService (HTTP client)', () => {
  let service: RedditScraperService;
  let fetchMock: jest.SpyInstance;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'REDDIT_FETCHER_URL') return 'http://fetcher:3001';
      return null;
    }),
  };

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);
    service = new RedditScraperService(
      mockConfigService as unknown as ConfigService,
    );
  });

  afterEach(() => {
    fetchMock.mockRestore();
    jest.clearAllMocks();
  });

  describe('fetchTopPosts', () => {
    it('returns the { posts, isInvalid } superset from the fetcher', async () => {
      const posts = [
        {
          id: 'abc',
          title: 'Post',
          selftext: '',
          author: 'u1',
          score: 500,
          created_utc: 1000,
        },
      ];
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ posts, isInvalid: false }),
      });

      const result = await service.fetchTopPosts('webdev', 10);

      expect(result).toEqual({ posts, isInvalid: false });
      expect(fetchMock).toHaveBeenCalledWith(
        'http://fetcher:3001/top-posts/webdev?limit=10',
      );
    });

    it('throws when the fetcher responds with an error status', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 502,
      });

      await expect(service.fetchTopPosts('webdev', 10)).rejects.toThrow(/502/);
    });
  });
});
