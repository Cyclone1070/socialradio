import { Test, TestingModule } from '@nestjs/testing';
import { RedditScraperService } from './reddit-scraper.service';
import { ConfigService } from '@nestjs/config';
import { chromium } from 'playwright-extra';

// Declare mocks at root scope so they are accessible by tests
const mockPage = {
  addInitScript: jest.fn(),
  goto: jest.fn(),
  waitForSelector: jest.fn().mockResolvedValue(undefined),
  evaluate: jest.fn(),
  screenshot: jest.fn(),
  close: jest.fn(),
  route: jest.fn().mockResolvedValue(undefined),
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

// Mock @ghostery/adblocker-playwright with embedded mock to avoid TDZ error
const mockEnableBlocking = jest.fn().mockResolvedValue(undefined);

jest.mock('@ghostery/adblocker-playwright', () => {
  return {
    PlaywrightBlocker: {
      fromPrebuiltAdsAndTracking: jest.fn().mockImplementation(() =>
        Promise.resolve({
          enableBlockingInPage: mockEnableBlocking,
        }),
      ),
    },
  };
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
    it('should connect to browserless, use generated fingerprint options with macOS restriction, enable adblocker, and scrape posts', async () => {
      // Setup evaluate mock to return the final parsed output structure from evaluate
      mockPage.evaluate.mockResolvedValue([
        {
          id: 'post123',
          title: 'Title of Post',
          author: 'author1',
          score: 500,
          created_utc: 1784084400,
        },
      ]);

      const result = await service.fetchTopPosts('webdev', 10);

      expect(chromium.connect).toHaveBeenCalledWith(
        'ws://mock-browserless:3000/playwright',
      );

      // Verify that fingerprint generator was called with macos restriction
      expect(mockGetFingerprint).toHaveBeenCalledWith(
        expect.objectContaining({
          browsers: ['chrome'],
          devices: ['desktop'],
          operatingSystems: ['macos'],
        }),
      );

      // Verify that newContext was invoked with the mock fingerprint values
      expect(mockBrowser.newContext).toHaveBeenCalledWith(
        expect.objectContaining({
          userAgent: 'mock-stealth-user-agent',
          viewport: { width: 1440, height: 900 },
          locale: 'en-GB',
        }),
      );

      // Verify Ghostery Adblocker was enabled on the page
      expect(mockEnableBlocking).toHaveBeenCalledWith(mockPage);

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://www.reddit.com/r/webdev/',
        expect.any(Object),
      );
      expect(mockPage.waitForSelector).toHaveBeenCalledWith(
        'shreddit-post',
        expect.any(Object),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('post123');
      expect(result[0].title).toBe('Title of Post');
      expect(result[0].created_utc).toBe(1784084400);
    });

    it('should throw error if BROWSERLESS_WS_URL is not configured', async () => {
      mockConfigService.get.mockReturnValueOnce(null);
      await expect(service.fetchTopPosts('webdev', 10)).rejects.toThrow(
        'BROWSERLESS_WS_URL is not configured',
      );
    });
  });

  describe('exists', () => {
    it('should return true if subreddit page loads successfully without not-found indicators', async () => {
      mockPage.evaluate.mockResolvedValue(
        'Welcome to r/webdev! The community for web developers.',
      );

      const result = await service.exists('webdev');
      expect(result).toBe(true);
    });

    it('should return false if subreddit page indicates it does not exist', async () => {
      mockPage.evaluate.mockResolvedValue(
        'Community not found. Create a community or explore others.',
      );

      const result = await service.exists('invalidSubreddit');
      expect(result).toBe(false);
    });
  });

  describe('fetchPostComments', () => {
    it('should fetch comments for a post thread', async () => {
      mockPage.evaluate.mockResolvedValue([
        {
          id: 'comment123',
          body: 'Comment body text',
          author: 'commenter1',
          score: 15,
          parent_id: '',
          created_utc: 1784085000,
        },
      ]);

      const result = await service.fetchPostComments('webdev', 'post123', 20);

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://www.reddit.com/r/webdev/comments/post123/',
        expect.any(Object),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('comment123');
      expect(result[0].body).toBe('Comment body text');
    });
  });
});
