import { JSDOM } from 'jsdom';
import request from 'supertest';
import { RedditScraper } from './scraper';
import { createApp } from './app';
import { Pacer } from './pacer';
import pino from 'pino';
import { waitForStableTree } from './dom';

jest.mock('playwright-extra', () => ({
  chromium: { use: jest.fn(), connect: jest.fn() },
}));
jest.mock('puppeteer-extra-plugin-stealth', () => ({
  __esModule: true,
  default: jest.fn(() => ({})),
}));
jest.mock('./comment-collection', () => ({ collectComments: jest.fn() }));
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

const { chromium } = jest.requireMock<{
  chromium: { use: jest.Mock; connect: jest.Mock };
}>('playwright-extra');

function makePageMock() {
  const page = {
    goto: jest.fn().mockResolvedValue(undefined),
    waitForSelector: jest.fn().mockResolvedValue(true),
    waitForFunction: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
    context: jest.fn(),
    url: jest
      .fn()
      .mockReturnValue('https://www.reddit.com/r/webdev/comments/postabc/'),
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

function makeFakeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  } as unknown as pino.Logger;
}

describe('RedditScraper.fetchTopPosts', () => {
  const feedHtml =
    '<shreddit-post id="t3_abc" post-title="Post title" author="u1" score="500" created-timestamp="2026-11-13T00:00:00.000000+0000"></shreddit-post>';

  it('parses rendered posts without a .json request', async () => {
    const page = makePageMock();
    page.evaluate.mockImplementation((fn: () => unknown) => {
      switch (fn.name) {
        case 'readPostFeed':
          return { html: feedHtml, count: 1, valid: true };
        case 'scrollForMorePosts':
          return 1;
        case 'waitForPostGrowth':
          return false;
        default:
          throw new Error(`unexpected evaluate: ${fn.name}`);
      }
    });
    chromium.connect.mockResolvedValue(makeBrowserMock(page));

    const scraper = new RedditScraper('ws://browserless:3000');
    const result = await scraper.fetchTopPosts('webdev', { limit: 10 });

    expect(result).toEqual({
      posts: [
        {
          id: 'abc',
          title: 'Post title',
          selftext: '',
          author: 'u1',
          score: 500,
          created_utc: 1794528000,
        },
      ],
      after: null,
      isInvalid: false,
    });
    expect(page.goto).toHaveBeenCalledWith(
      'https://www.reddit.com/r/webdev/top/?t=week',
      expect.anything(),
    );
    expect(JSON.stringify(page.evaluate.mock.calls)).not.toContain('.json');
  });

  it('returns isInvalid true when the subreddit shell has no feed', async () => {
    const page = makePageMock();
    page.evaluate.mockResolvedValue({ html: '', count: 0, valid: false });
    chromium.connect.mockResolvedValue(makeBrowserMock(page));

    const scraper = new RedditScraper('ws://browserless:3000');
    const result = await scraper.fetchTopPosts('deadsub', { limit: 10 });

    expect(result).toEqual({ posts: [], after: null, isInvalid: true });
  });
});

describe('RedditScraper.exists', () => {
  it('waits for the feed before deciding, so a slow render is not a false negative', async () => {
    const page = makePageMock();
    page.evaluate
      .mockResolvedValueOnce({ html: '', count: 0, valid: false })
      .mockResolvedValue({ html: '', count: 0, valid: true });
    chromium.connect.mockResolvedValue(makeBrowserMock(page));

    const scraper = new RedditScraper('ws://browserless:3000');

    await expect(scraper.exists('webdev')).resolves.toBe(true);
    expect(page.waitForSelector).toHaveBeenCalledWith(
      'shreddit-feed, shreddit-subreddit-header',
      expect.anything(),
    );
  });

  it('is true when the rendered page has a feed or header', async () => {
    const page = makePageMock();
    page.evaluate.mockResolvedValue({ html: '', count: 0, valid: true });
    chromium.connect.mockResolvedValue(makeBrowserMock(page));

    const scraper = new RedditScraper('ws://browserless:3000');

    await expect(scraper.exists('webdev')).resolves.toBe(true);
  });

  it('is false for the empty shell of a missing subreddit', async () => {
    const page = makePageMock();
    page.evaluate.mockResolvedValue({ html: '', count: 0, valid: false });
    chromium.connect.mockResolvedValue(makeBrowserMock(page));

    const scraper = new RedditScraper('ws://browserless:3000');

    await expect(
      scraper.exists('this_subreddit_cannot_exist_9f3a2b'),
    ).resolves.toBe(false);
  });
});

describe('RedditScraper.fetchPostComments', () => {
  const { collectComments } = jest.requireMock<{ collectComments: jest.Mock }>(
    './comment-collection',
  );

  const collected = {
    comments: [
      {
        id: 'c1',
        body: 'body',
        author: 'a1',
        score: 5,
        parent_id: 'postabc',
        created_utc: 111,
      },
    ],
    renderedCount: 2,
    expandedCount: 1,
  };

  beforeEach(() => {
    collectComments.mockReset();
    chromium.connect.mockReset();
  });

  it('opens the thread and delegates expansion to the collector', async () => {
    const page = makePageMock();
    chromium.connect.mockResolvedValue(makeBrowserMock(page));
    collectComments.mockResolvedValue(collected);

    const scraper = new RedditScraper('ws://browserless:3000');
    const result = await scraper.fetchPostComments('webdev', 'postabc');

    expect(result).toEqual(collected.comments);
    expect(page.goto).toHaveBeenCalledWith(
      'https://www.reddit.com/r/webdev/comments/postabc/',
      expect.anything(),
    );
    expect(page.waitForSelector).toHaveBeenCalledWith(
      'shreddit-comment',
      expect.anything(),
    );
    expect(page.evaluate).toHaveBeenCalledWith(waitForStableTree, {
      quietMs: 250,
      maxMs: 3000,
    });
    const [readerArg, optionsArg] = collectComments.mock.calls[0] as [
      { readTree: unknown; clickMoreBatch: unknown },
      { postId: string; budgetMs: number; collectContinuations: unknown },
    ];
    expect(typeof readerArg.readTree).toBe('function');
    expect(typeof readerArg.clickMoreBatch).toBe('function');
    expect(optionsArg.postId).toBe('postabc');
    expect(optionsArg.budgetMs).toBeLessThanOrEqual(85_000);
    expect(typeof optionsArg.collectContinuations).toBe('function');
  });

  it('fails when reddit redirects to a different thread', async () => {
    const page = makePageMock();
    page.url.mockReturnValue(
      'https://www.reddit.com/r/Screenwriting/comments/abc123/other/',
    );
    chromium.connect.mockResolvedValue(makeBrowserMock(page));

    const scraper = new RedditScraper('ws://browserless:3000');

    await expect(
      scraper.fetchPostComments('webdev', 'postabc'),
    ).rejects.toThrow(/redirected/i);
  });

  it('fails loudly when the page is forbidden', async () => {
    const page = makePageMock();
    page.evaluate.mockImplementation((fn: (doc?: Document) => unknown) => {
      if (fn.name === 'isForbiddenPage') {
        return fn(
          new JSDOM('<div id="shreddit-forbidden"></div>').window.document,
        );
      }
      throw new Error(`unexpected evaluate: ${fn.name}`);
    });
    chromium.connect.mockResolvedValue(makeBrowserMock(page));

    const scraper = new RedditScraper('ws://browserless:3000');

    await expect(
      scraper.fetchPostComments('webdev', 'postabc'),
    ).rejects.toThrow(/forbidden/i);
  });

  it('does not retry an evaluate timeout', async () => {
    const actual = jest.requireActual<typeof import('./comment-collection')>(
      './comment-collection',
    );
    collectComments.mockImplementation(actual.collectComments);

    const page = makePageMock();
    page.evaluate.mockImplementation((fn: () => unknown) => {
      if (fn.name === 'isForbiddenPage') return false;
      return Promise.reject(new Error('evaluate timed out after 10000 ms'));
    });
    chromium.connect.mockResolvedValue(makeBrowserMock(page));

    const scraper = new RedditScraper('ws://browserless:3000');
    await expect(
      scraper.fetchPostComments('webdev', 'postabc'),
    ).rejects.toThrow(/timed out/);

    expect(page.evaluate).toHaveBeenCalledTimes(4);
  });

  it('merges a continuation page and drops the duplicate linked comment', async () => {
    const actual = jest.requireActual<typeof import('./comment-collection')>(
      './comment-collection',
    );
    collectComments.mockImplementation(actual.collectComments);

    const mainHtml =
      '<shreddit-comment thingid="t1_owner" author="alice" score="10" created="2026-11-13T00:00:00.000000+0000" depth="0"><div slot="comment">owner</div></shreddit-comment>';
    const continuationHtml =
      '<shreddit-comment thingid="t1_owner" author="alice" score="10" created="2026-11-13T00:00:00.000000+0000" depth="0"><div slot="comment">owner</div>' +
      '<div id="comment-children"><shreddit-comment thingid="t1_child" author="bob" score="3" created="2026-11-13T00:00:00.000000+0000" depth="1"><div slot="comment">deep reply</div></shreddit-comment></div></shreddit-comment>';

    const mainPage = makePageMock();
    mainPage.evaluate.mockImplementation((fn: () => unknown) => {
      switch (fn.name) {
        case 'readCommentCount':
          return 2;
        case 'readCommentTree':
          return { html: mainHtml, count: 1 };
        case 'clickMoreReplies':
          return false;
        case 'findContinuationLinks':
          return [
            {
              href: '/r/webdev/comments/postabc/comment/owner/?force-legacy-sct=1',
              ownerId: 't1_owner',
            },
          ];
        case 'isForbiddenPage':
          return false;
        case 'clickMoreRepliesBatch':
          return 0;
        case 'waitForStableTree':
          return 2;
        case 'waitForCommentGrowth':
          return false;
        default:
          throw new Error(`unexpected evaluate: ${fn.name}`);
      }
    });

    const continuationPage = makePageMock();
    continuationPage.evaluate.mockImplementation((fn: () => unknown) => {
      switch (fn.name) {
        case 'readCommentCount':
          return 2;
        case 'readCommentTree':
          return { html: continuationHtml, count: 2 };
        case 'clickMoreReplies':
          return false;
        case 'findContinuationLinks':
          return [];
        case 'isForbiddenPage':
          return false;
        case 'clickMoreRepliesBatch':
          return 0;
        case 'waitForStableTree':
          return 2;
        case 'waitForCommentGrowth':
          return false;
        default:
          throw new Error(`unexpected evaluate: ${fn.name}`);
      }
    });

    const context = {
      newPage: jest.fn().mockResolvedValue(continuationPage),
      close: jest.fn().mockResolvedValue(undefined),
    };
    mainPage.context.mockReturnValue(context);
    chromium.connect.mockResolvedValue(makeBrowserMock(mainPage));

    const scraper = new RedditScraper('ws://browserless:3000');
    const comments = await scraper.fetchPostComments('webdev', 'postabc');

    expect(comments.map((c) => c.id)).toEqual(['owner', 'child']);
    expect(comments[1].parent_id).toBe('owner');
    expect(mainPage.goto).toHaveBeenCalledTimes(1);
    expect(context.newPage).toHaveBeenCalledTimes(1);
    expect(continuationPage.goto).toHaveBeenCalledWith(
      'https://www.reddit.com/r/webdev/comments/postabc/comment/owner/?force-legacy-sct=1',
      expect.anything(),
    );
    expect(continuationPage.close).toHaveBeenCalled();
  });

  it('waits for a stable tree with a three second cap', async () => {
    const page = makePageMock();
    chromium.connect.mockResolvedValue(makeBrowserMock(page));
    collectComments.mockResolvedValue(collected);

    const scraper = new RedditScraper('ws://browserless:3000');
    await scraper.fetchPostComments('webdev', 'postabc');

    expect(page.evaluate).toHaveBeenCalledWith(waitForStableTree, {
      quietMs: 250,
      maxMs: 3000,
    });
  });

  it('logs one info line with rendered, expanded and returned counts', async () => {
    const page = makePageMock();
    chromium.connect.mockResolvedValue(makeBrowserMock(page));
    collectComments.mockResolvedValue(collected);
    const logger = makeFakeLogger() as unknown as { info: jest.Mock };

    const scraper = new RedditScraper(
      'ws://browserless:3000',
      logger as unknown as pino.Logger,
    );
    await scraper.fetchPostComments('webdev', 'postabc');

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        renderedCount: 2,
        expandedCount: 1,
        returnedCount: 1,
        continuationMs: 0,
      }),
      'comments collected',
    );

    const calls = logger.info.mock.calls as unknown as [
      Record<string, unknown>,
      string,
    ][];
    const logged = calls.find(([fields]) => fields.renderedCount === 2);
    expect(typeof logged?.[0].ms).toBe('number');
    expect(typeof logged?.[0].loadMs).toBe('number');
    expect(typeof logged?.[0].expansionMs).toBe('number');
    expect(logged?.[0].continuationMs).toBe(0);
  });

  it('parses the rendered tree through the real collector without a .json request', async () => {
    const actual = jest.requireActual<typeof import('./comment-collection')>(
      './comment-collection',
    );
    collectComments.mockImplementation(actual.collectComments);

    const treeHtml = `
      <shreddit-comment thingid="t1_a" author="alice" score="10"
        created="2026-11-13T00:00:00.000000+0000" depth="0">
        <div slot="comment">top comment</div>
        <div id="comment-children">
          <shreddit-comment thingid="t1_b" author="bob" score="3"
            created="2026-11-13T00:00:00.000000+0000" depth="1">
            <div slot="comment">reply</div>
          </shreddit-comment>
        </div>
      </shreddit-comment>`;

    const page = makePageMock();
    page.evaluate.mockImplementation((fn: () => unknown) => {
      switch (fn.name) {
        case 'readCommentCount':
          return 2;
        case 'readCommentTree':
          return { html: treeHtml, count: 2 };
        case 'clickMoreReplies':
          return false;
        case 'findContinuationLinks':
          return [];
        case 'isForbiddenPage':
          return false;
        case 'clickMoreRepliesBatch':
          return 0;
        case 'waitForStableTree':
          return 2;
        case 'waitForCommentGrowth':
          return false;
        default:
          throw new Error(`unexpected evaluate: ${fn.name}`);
      }
    });
    chromium.connect.mockResolvedValue(makeBrowserMock(page));

    const scraper = new RedditScraper('ws://browserless:3000');
    const comments = await scraper.fetchPostComments('webdev', 'postabc');

    expect(comments).toEqual([
      {
        id: 'a',
        body: 'top comment',
        author: 'alice',
        score: 10,
        parent_id: 'postabc',
        created_utc: 1794528000,
      },
      {
        id: 'b',
        body: 'reply',
        author: 'bob',
        score: 3,
        parent_id: 'a',
        created_utc: 1794528000,
      },
    ]);

    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(page.evaluate.mock.calls)).not.toContain('.json');
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
    livePage.evaluate.mockImplementation((fn: () => unknown) => {
      switch (fn.name) {
        case 'readPostFeed':
          return {
            html: '<shreddit-post id="t3_abc" post-title="T" author="u1" score="5" created-timestamp="2026-11-13T00:00:00.000000+0000"></shreddit-post>',
            count: 1,
            valid: true,
          };
        case 'scrollForMorePosts':
          return 1;
        case 'waitForPostGrowth':
          return false;
        default:
          throw new Error(`unexpected evaluate: ${fn.name}`);
      }
    });
    chromium.connect
      .mockResolvedValueOnce(makeBrowserMock(deadPage))
      .mockResolvedValueOnce(makeBrowserMock(livePage));

    const scraper = new RedditScraper('ws://browserless:3000');
    const result = await scraper.fetchTopPosts('webdev', {});

    expect(result).toEqual({
      posts: [
        {
          id: 'abc',
          title: 'T',
          selftext: '',
          author: 'u1',
          score: 5,
          created_utc: 1794528000,
        },
      ],
      after: null,
      isInvalid: false,
    });
    expect(chromium.connect).toHaveBeenCalledTimes(2);
  });
});

describe('RedditScraper logging', () => {
  beforeEach(() => {
    chromium.connect.mockReset();
  });

  it('warns once when a dead browser session forces a reconnect', async () => {
    const deadPage = makePageMock();
    deadPage.evaluate.mockRejectedValue(
      new Error('Target page, context or browser has been closed'),
    );
    const livePage = makePageMock();
    livePage.evaluate.mockResolvedValue({
      html: '',
      count: 0,
      valid: true,
    });
    chromium.connect
      .mockResolvedValueOnce(makeBrowserMock(deadPage))
      .mockResolvedValueOnce(makeBrowserMock(livePage));
    const logger = makeFakeLogger();

    const scraper = new RedditScraper('ws://browserless:3000', logger);
    await scraper.fetchTopPosts('webdev', {});

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe('forbidden thread through the route', () => {
  it('answers 502 when the rendered page is forbidden', async () => {
    const page = makePageMock();
    page.evaluate.mockImplementation((fn: (doc?: Document) => unknown) => {
      if (fn.name === 'isForbiddenPage') {
        return fn(
          new JSDOM('<form><input type="password"></form>').window.document,
        );
      }
      throw new Error(`unexpected evaluate: ${fn.name}`);
    });
    chromium.connect.mockResolvedValue(makeBrowserMock(page));

    const scraper = new RedditScraper(
      'ws://browserless:3000',
      pino({ level: 'silent' }),
    );
    const app = createApp(scraper, new Pacer({ minDelayMs: 0, maxDelayMs: 0 }));

    const res = await request(app).get('/comments/webdev/postabc');

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'reddit returned a forbidden page' });
  });
});
