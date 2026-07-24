import { Test, TestingModule } from '@nestjs/testing';
import { RedditScraperService } from './reddit-scraper.service';
import { ConfigService } from '@nestjs/config';
import { chromium } from 'playwright-extra';

// Declare mocks at root scope so they are accessible by tests
const mockPage = {
  addInitScript: jest.fn(),
  goto: jest.fn(),
  waitForSelector: jest.fn(),
  evaluate: jest.fn(),
  screenshot: jest.fn(),
  close: jest.fn(),
  route: jest.fn().mockResolvedValue(undefined),
  waitForTimeout: jest.fn().mockResolvedValue(undefined),
  waitForLoadState: jest.fn(),
};

const mockContext = {
  newPage: jest.fn().mockResolvedValue(mockPage),
  close: jest.fn(),
};

const mockBrowser = {
  newContext: jest.fn().mockResolvedValue(mockContext),
  close: jest.fn(),
  on: jest.fn(),
};

// Mock playwright-extra
jest.mock('playwright-extra', () => {
  return {
    chromium: {
      use: jest.fn(),
      connect: jest.fn().mockImplementation(() => Promise.resolve(mockBrowser)),
    },
  };
});

// Mock puppeteer-extra-plugin-stealth
jest.mock('puppeteer-extra-plugin-stealth', () => {
  return jest.fn().mockImplementation(() => ({}));
});

// Mock fingerprint-generator
const mockFingerprint = {
  navigator: {
    userAgent: 'mock-stealth-user-agent',
    language: 'en-GB',
  },
  screen: { width: 1440, height: 900 },
};

const mockGetFingerprint = jest
  .fn()
  .mockReturnValue({ fingerprint: mockFingerprint });

jest.mock('fingerprint-generator', () => {
  return {
    FingerprintGenerator: jest.fn().mockImplementation(() => ({
      getFingerprint: mockGetFingerprint,
    })),
  };
});

describe('RedditScraperService', () => {
  let service: RedditScraperService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'BROWSERLESS_WS_URL')
        return 'ws://mock-browserless:3000/playwright';
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedditScraperService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<RedditScraperService>(RedditScraperService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('fetchTopPosts', () => {
    it('should connect to browserless, wait for shreddit-post, execute in-page fetch for JSON, and parse posts with at least 40 comments', async () => {
      mockPage.waitForSelector.mockResolvedValue(undefined);

      const mockJsonFeed = {
        data: {
          children: [
            {
              kind: 't3',
              data: {
                id: 'post123',
                title: 'Title of Post',
                author: 'author1',
                score: 500,
                created_utc: 1784084400,
                selftext: 'Self text here',
                num_comments: 15, // Should be skipped
              },
            },
            {
              kind: 't3',
              data: {
                id: 'post456',
                title: 'Another Post Title',
                author: 'author2',
                score: 1200,
                created_utc: 1784085000,
                selftext: 'More text',
                num_comments: 50, // Should be included
              },
            },
          ],
        },
      };

      mockPage.evaluate.mockResolvedValue(mockJsonFeed);

      const result = await service.fetchTopPosts('webdev', 10);

      expect(chromium.connect).toHaveBeenCalledWith(
        'ws://mock-browserless:3000/playwright',
      );

      // Verify page loaded normal URL first
      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://www.reddit.com/r/webdev/',
        expect.any(Object),
      );

      // Verify deterministic wait for selector
      expect(mockPage.waitForSelector).toHaveBeenCalledWith(
        'shreddit-post',
        expect.any(Object),
      );

      // Verify page.evaluate was called to fetch relative JSON
      expect(mockPage.evaluate).toHaveBeenCalled();

      // Only post456 should be returned (15 comments was skipped)
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('post456');
      expect(result[0].title).toBe('Another Post Title');
      expect(result[0].created_utc).toBe(1784085000);
      expect(result[0].author).toBe('author2');
    });

    it('should throw error if BROWSERLESS_WS_URL is not configured', async () => {
      mockConfigService.get.mockReturnValueOnce(null);
      await expect(service.fetchTopPosts('webdev', 10)).rejects.toThrow(
        'BROWSERLESS_WS_URL is not configured',
      );
    });
  });

  describe('exists', () => {
    it('should return true if subreddit page loads and renders shreddit-posts using Option A', async () => {
      mockPage.waitForLoadState.mockResolvedValue(undefined);
      mockPage.evaluate.mockResolvedValue(1); // 1 post found

      const result = await service.exists('webdev');
      expect(result).toBe(true);
      expect(mockPage.waitForLoadState).toHaveBeenCalledWith('networkidle', {
        timeout: 8000,
      });
    });

    it('should return false if shreddit-post is not found even if load state succeeds', async () => {
      mockPage.waitForLoadState.mockResolvedValue(undefined);
      mockPage.evaluate.mockResolvedValue(0); // 0 posts found

      const result = await service.exists('invalidSubreddit');
      expect(result).toBe(false);
      expect(mockPage.waitForLoadState).toHaveBeenCalledWith('networkidle', {
        timeout: 8000,
      });
    });
  });

  describe('fetchPostComments', () => {
    it('should navigate to the post, wait for shreddit-post, execute in-page fetch for JSON, and recursively flatten comments', async () => {
      mockPage.waitForSelector.mockResolvedValue(undefined);

      const mockJsonTree = [
        {
          data: {
            children: [{ data: { id: 'post123', title: 'Post Title' } }],
          },
        },
        {
          data: {
            children: [
              {
                kind: 't1',
                data: {
                  id: 'comment1',
                  body: 'Parent comment text',
                  author: 'author1',
                  score: 10,
                  parent_id: 't3_post123',
                  created_utc: 1784085000,
                  replies: {
                    data: {
                      children: [
                        {
                          kind: 't1',
                          data: {
                            id: 'comment2',
                            body: 'Child comment text',
                            author: 'author2',
                            score: 5,
                            parent_id: 't1_comment1',
                            created_utc: 1784085100,
                            replies: '',
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      ];

      mockPage.evaluate.mockResolvedValue(mockJsonTree);

      const result = await service.fetchPostComments('webdev', 'post123');

      // Verify page loaded normal URL first
      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://www.reddit.com/r/webdev/comments/post123/',
        expect.any(Object),
      );

      // Verify deterministic wait for selector
      expect(mockPage.waitForSelector).toHaveBeenCalledWith(
        'shreddit-post',
        expect.any(Object),
      );

      // Verify page.evaluate was called to fetch relative JSON
      expect(mockPage.evaluate).toHaveBeenCalled();

      // Verify result has both parent and child comments flattened
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('comment1');
      expect(result[0].body).toBe('Parent comment text');
      expect(result[0].parent_id).toBe('post123');

      expect(result[1].id).toBe('comment2');
      expect(result[1].body).toBe('Child comment text');
      expect(result[1].parent_id).toBe('comment1');
    });
  });
});
