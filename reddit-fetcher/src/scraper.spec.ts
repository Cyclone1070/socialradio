import { RedditScraper } from './scraper';

jest.mock('playwright-extra', () => ({
  chromium: { use: jest.fn(), connect: jest.fn() },
}));
jest.mock('puppeteer-extra-plugin-stealth', () => ({
  __esModule: true,
  default: jest.fn(() => ({})),
}));
jest.mock('fingerprint-generator', () => ({
  FingerprintGenerator: jest.fn().mockImplementation(() => ({
    getFingerprint: jest.fn(() => ({
      fingerprint: {
        navigator: { userAgent: 'test-ua', language: 'en-US' },
        screen: { width: 1920, height: 1080 },
      },
    })),
  })),
}));

function makePageMock() {
  const page = {
    goto: jest.fn().mockResolvedValue(undefined),
    waitForSelector: jest.fn().mockResolvedValue(true),
    evaluate: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return page;
}

function makeBrowserMock(page: ReturnType<typeof makePageMock>) {
  return {
    newContext: jest.fn().mockResolvedValue({
      newPage: jest.fn().mockResolvedValue(page),
      close: jest.fn().mockResolvedValue(undefined),
    }),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

function makeDeadBrowserMock() {
  return {
    newContext: jest.fn().mockRejectedValue(new Error('Browser has been closed')),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

const chromium = jest.requireMock('playwright-extra').chromium;

describe('RedditScraper.fetchTopPosts', () => {
  it('returns { posts, isInvalid: false } mapping listing JSON', async () => {
    const page = makePageMock();
    page.evaluate.mockResolvedValue({
      data: {
        children: [
          {
            kind: 't3',
            data: {
              id: 'abc',
              title: 'Post title',
              selftext: 'body',
              author: 'u1',
              score: 500,
              num_comments: 60,
              created_utc: 1000,
            },
          },
          {
            kind: 't3',
            data: {
              id: 'low',
              title: 'Too few comments',
              selftext: '',
              author: 'u2',
              score: 2,
              num_comments: 3,
              created_utc: 2000,
            },
          },
        ],
      },
    });
    chromium.connect.mockResolvedValue(makeBrowserMock(page));

    const scraper = new RedditScraper('ws://browserless:3000');
    const result = await scraper.fetchTopPosts('webdev', 10);

    expect(result).toEqual({
      posts: [
        {
          id: 'abc',
          title: 'Post title',
          selftext: 'body',
          author: 'u1',
          score: 500,
          created_utc: 1000,
        },
      ],
      isInvalid: false,
    });
    expect(page.goto).toHaveBeenCalledWith(
      'https://www.reddit.com/r/webdev/',
      expect.anything(),
    );
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 10);
  });

  it('returns { posts: [], isInvalid: true } for a dead subreddit (no posts selector)', async () => {
    const page = makePageMock();
    page.waitForSelector.mockRejectedValue(new Error('Timeout 15000ms exceeded'));
    chromium.connect.mockResolvedValue(makeBrowserMock(page));

    const scraper = new RedditScraper('ws://browserless:3000');
    const result = await scraper.fetchTopPosts('deadsub', 10);

    expect(result).toEqual({ posts: [], isInvalid: true });
    expect(page.evaluate).not.toHaveBeenCalled();
  });
});

describe('RedditScraper.fetchPostComments', () => {
  it('flattens nested comment trees and strips id prefixes', async () => {
    const page = makePageMock();
    page.evaluate.mockResolvedValue([
      { data: { children: [] } },
      {
        data: {
          children: [
            {
              kind: 't1',
              data: {
                id: 't1_comment1',
                body: 'Top comment',
                author: 'a1',
                score: 10,
                parent_id: 't3_postabc',
                created_utc: 111,
                replies: {
                  data: {
                    children: [
                      {
                        kind: 't1',
                        data: {
                          id: 't1_comment2',
                          body: 'Nested reply',
                          author: 'a2',
                          score: 5,
                          parent_id: 't1_comment1',
                          created_utc: 222,
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
    ]);
    chromium.connect.mockResolvedValue(makeBrowserMock(page));

    const scraper = new RedditScraper('ws://browserless:3000');
    const result = await scraper.fetchPostComments('webdev', 'postabc');

    expect(result).toEqual([
      {
        id: 'comment1',
        body: 'Top comment',
        author: 'a1',
        score: 10,
        parent_id: 'postabc',
        created_utc: 111,
      },
      {
        id: 'comment2',
        body: 'Nested reply',
        author: 'a2',
        score: 5,
        parent_id: 'comment1',
        created_utc: 222,
      },
    ]);
  });

  it('throws when the comments JSON fails to parse', async () => {
    const page = makePageMock();
    page.waitForSelector.mockRejectedValue(new Error('Timeout 15000ms exceeded'));
    chromium.connect.mockResolvedValue(makeBrowserMock(page));

    const scraper = new RedditScraper('ws://browserless:3000');
    await expect(
      scraper.fetchPostComments('webdev', 'postabc'),
    ).rejects.toThrow('Timeout');
  });
});

describe('RedditScraper.exists', () => {
  it('returns false when the page has no shreddit-post elements', async () => {
    const page = makePageMock();
    page.evaluate.mockResolvedValue(0);
    chromium.connect.mockResolvedValue(makeBrowserMock(page));

    const scraper = new RedditScraper('ws://browserless:3000');
    await expect(scraper.exists('deadsub')).resolves.toBe(false);
  });

  it('returns true when posts are present', async () => {
    const page = makePageMock();
    page.evaluate.mockResolvedValue(5);
    chromium.connect.mockResolvedValue(makeBrowserMock(page));

    const scraper = new RedditScraper('ws://browserless:3000');
    await expect(scraper.exists('webdev')).resolves.toBe(true);
    expect(page.goto).toHaveBeenCalledWith(
      'https://www.reddit.com/r/webdev/',
      expect.anything(),
    );
  });
});

describe('RedditScraper context affinity', () => {
  it('reuses one context for a subreddit; a different subreddit gets a fresh context', async () => {
    const page1 = makePageMock();
    page1.evaluate.mockResolvedValue({ data: { children: [] } });
    const page2 = makePageMock();
    page2.evaluate.mockResolvedValue({ data: { children: [] } });
    const browserMock = {
      newContext: jest
        .fn()
        .mockResolvedValueOnce({
          newPage: jest.fn().mockResolvedValue(page1),
        })
        .mockResolvedValueOnce({
          newPage: jest.fn().mockResolvedValue(page2),
        }),
    };
    chromium.connect.mockResolvedValue(browserMock);

    const scraper = new RedditScraper('ws://browserless:3000');
    await scraper.fetchTopPosts('webdev', 10);
    await scraper.fetchTopPosts('webdev', 10);
    await scraper.fetchTopPosts('javascript', 10);

    expect(browserMock.newContext).toHaveBeenCalledTimes(2);
  });
});

describe('RedditScraper dead-connection recovery', () => {
  beforeEach(() => {
    chromium.connect.mockReset();
  });

  it('reconnects and retries when the browser session is killed mid-operation', async () => {
    const deadPage = makePageMock();
    deadPage.evaluate.mockRejectedValue(
      new Error('Target page, context or browser has been closed'),
    );
    const livePage = makePageMock();
    livePage.evaluate.mockResolvedValue({
      data: {
        children: [
          {
            kind: 't3',
            data: {
              id: 'abc',
              title: 'T',
              selftext: '',
              author: 'u1',
              score: 5,
              num_comments: 60,
              created_utc: 1000,
            },
          },
        ],
      },
    });
    chromium.connect
      .mockResolvedValueOnce(makeBrowserMock(deadPage))
      .mockResolvedValueOnce(makeBrowserMock(livePage));

    const scraper = new RedditScraper('ws://browserless:3000');
    const result = await scraper.fetchTopPosts('webdev', 10);

    expect(result).toEqual({
      posts: [
        {
          id: 'abc',
          title: 'T',
          selftext: '',
          author: 'u1',
          score: 5,
          created_utc: 1000,
        },
      ],
      isInvalid: false,
    });
    expect(chromium.connect).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-connection errors', async () => {
    chromium.connect.mockReset();
    const page = makePageMock();
    page.evaluate.mockRejectedValue(new Error('Unexpected end of JSON input'));
    chromium.connect.mockResolvedValue(makeBrowserMock(page));

    const scraper = new RedditScraper('ws://browserless:3000');
    await expect(scraper.fetchTopPosts('webdev', 10)).rejects.toThrow(
      'Unexpected end of JSON input',
    );
    expect(chromium.connect).toHaveBeenCalledTimes(1);
  });
});