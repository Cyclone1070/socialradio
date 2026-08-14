import { RedditScraperService } from './reddit-scraper.service';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

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
    it('returns the { posts, after, isInvalid } superset from the fetcher', async () => {
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
        json: () =>
          Promise.resolve({ posts, after: 't3_next', isInvalid: false }),
      });

      const result = await service.fetchTopPosts('webdev', {
        limit: 10,
        after: 't3_x',
      });

      expect(result).toEqual({ posts, after: 't3_next', isInvalid: false });
      expect(fetchMock).toHaveBeenCalledWith(
        'http://fetcher:3001/top-posts/webdev?limit=10&after=t3_x',
      );
    });

    it('throws when the fetcher responds with an error status', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 502,
      });

      await expect(
        service.fetchTopPosts('webdev', { limit: 10 }),
      ).rejects.toThrow(/502/);
    });
  });

  describe('round-trip logs', () => {
    it('logs a debug line per successful fetcher call with path, status and ms', async () => {
      const debugSpy = jest
        .spyOn(PinoLogger.prototype, 'debug')
        .mockImplementation(() => {});
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ posts: [], after: null, isInvalid: false }),
      });

      await service.fetchTopPosts('webdev', { limit: 10 });

      expect(debugSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/top-posts/webdev?limit=10',
          status: 200,
          ms: expect.any(Number) as number,
        }),
        expect.stringContaining('fetcher'),
      );
    });

    it('warns when the fetcher returns a non-ok status, with status in the log', async () => {
      const warnSpy = jest
        .spyOn(PinoLogger.prototype, 'warn')
        .mockImplementation(() => {});
      fetchMock.mockResolvedValue({
        ok: false,
        status: 502,
      });

      await expect(
        service.fetchTopPosts('webdev', { limit: 10 }),
      ).rejects.toThrow();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/top-posts/webdev?limit=10',
          status: 502,
        }),
        expect.stringContaining('non-ok'),
      );
    });
  });
});
