import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedditFetcherContractError } from './dto/reddit-fetcher.dto';
import { RedditScraperService } from './reddit-scraper.service';

/**
 * The fetcher answers over HTTP, so the only way to know what arrived is to
 * check it. These are the two answers the backend must not misread: a payload
 * that no longer matches the contract, and a malformed one that would otherwise
 * look like "this subreddit does not exist" — callers delete rows on that.
 */
describe('RedditScraperService contract enforcement', () => {
  let service: RedditScraperService;
  const originalFetch = global.fetch;

  const respondWith = (payload: unknown): void => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
    });
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        RedditScraperService,
        {
          provide: ConfigService,
          useValue: { get: () => 'http://fetcher.test' },
        },
      ],
    }).compile();

    service = module.get<RedditScraperService>(RedditScraperService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('rejects a top-posts payload whose required field was renamed', async () => {
    respondWith({
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
    });

    await expect(service.fetchTopPosts('askreddit')).rejects.toThrow(
      RedditFetcherContractError,
    );
  });

  it('does not report a malformed exists payload as "subreddit does not exist"', async () => {
    respondWith({ valid: 'yes' });

    await expect(service.exists('askreddit')).rejects.toThrow(
      RedditFetcherContractError,
    );
  });
});
