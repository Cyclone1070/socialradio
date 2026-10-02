import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { RedditScraperService } from './reddit-scraper.service';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { RedditFetcherContractError } from './dto/reddit-fetcher.dto';

describe('RedditScraperService (HTTP client)', () => {
  let service: RedditScraperService;
  let fetchMock: jest.SpyInstance;

  const mockConfigService = {
    // Annotated rather than inferred: the tests below point the service at a real
    // local server, whose port only exists at runtime.
    get: jest.fn((key: string): string | null => {
      if (key === 'REDDIT_FETCHER_URL') return 'http://fetcher:3001';
      if (key === 'REDDIT_FETCHER_TIMEOUT_MS') return '300';
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
    });

    it('asks the fetcher for the subreddit top posts, paging from the cursor', async () => {
      const url = (input: RequestInfo | URL): string =>
        input instanceof URL
          ? input.href
          : typeof input === 'string'
            ? input
            : input.url;
      let seen = '';
      fetchMock.mockImplementationOnce((input: RequestInfo | URL) => {
        seen = url(input);
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ posts: [], after: null, isInvalid: false }),
        } as Response);
      });

      await service.fetchTopPosts('webdev', { limit: 10, after: 't3_x' });

      expect(seen).toBe(
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

  describe('payload validation', () => {
    it('rejects a top-posts payload whose required field was renamed', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            posts: [
              {
                id: 'abc123',
                titleText: 'renamed upstream',
                author: 'someone',
                score: 5,
                created_utc: 1_790_000_000,
              },
            ],
            after: null,
            isInvalid: false,
          }),
      });

      await expect(service.fetchTopPosts('askreddit')).rejects.toThrow(
        RedditFetcherContractError,
      );
    });

    it('does not report a malformed exists payload as "subreddit does not exist"', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ valid: 'yes' }),
      });

      // Callers delete rows when this answers "gone", so a garbled payload has to
      // throw rather than quietly answer false.
      await expect(service.exists('askreddit')).rejects.toThrow(
        RedditFetcherContractError,
      );
    });
  });

  describe('a fetcher call that never answers', () => {
    // A real server rather than a mocked fetch: the point of the deadline is what
    // happens to a socket that stays open and silent, which a mock cannot show.
    let server: http.Server;

    const startServer = async (
      handler: http.RequestListener,
    ): Promise<number> => {
      server = http.createServer(handler);
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      return (server.address() as AddressInfo).port;
    };

    const stopServer = async (): Promise<void> => {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    };

    beforeEach(() => {
      // Hand back the global fetch so the real client does real socket work.
      fetchMock.mockRestore();
      expect(typeof globalThis.fetch).toBe('function');
    });

    afterEach(async () => {
      await stopServer();
    });

    it('gives up at its deadline instead of waiting on it', async () => {
      const port = await startServer(() => {
        // deliberately never responds
      });
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'REDDIT_FETCHER_URL') return `http://127.0.0.1:${port}`;
        if (key === 'REDDIT_FETCHER_TIMEOUT_MS') return '300';
        return null;
      });

      const startedMs = Date.now();
      await expect(service.fetchTopPosts('technology')).rejects.toThrow(
        /deadline/i,
      );
      const elapsedMs = Date.now() - startedMs;

      // Without a deadline this test does not fail, it hangs until jest gives up.
      expect(elapsedMs).toBeLessThan(5000);
    }, 20000);

    it('leaves a healthy but slow-ish call alone', async () => {
      const port = await startServer((_req, res) => {
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ posts: [], after: null, isInvalid: false }));
        }, 100);
      });
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'REDDIT_FETCHER_URL') return `http://127.0.0.1:${port}`;
        if (key === 'REDDIT_FETCHER_TIMEOUT_MS') return '5000';
        return null;
      });

      const result = await service.fetchTopPosts('technology');

      expect(result.posts).toEqual([]);
    }, 20000);
  });
});
