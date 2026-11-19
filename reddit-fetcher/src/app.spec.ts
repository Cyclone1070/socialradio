import { Writable } from 'stream';
import request from 'supertest';
import pino from 'pino';
import { createApp } from './app';
import { RedditScraper } from './scraper';
import { Pacer } from './pacer';

jest.mock('./scraper', () => ({
  RedditScraper: jest.fn().mockImplementation(() => ({
    fetchTopPosts: jest.fn(),
  })),
}));

const scraper: { fetchTopPosts: jest.Mock; fetchPostComments: jest.Mock } = {
  fetchTopPosts: jest.fn(),
  fetchPostComments: jest.fn(),
};

describe('GET /top-posts/:subreddit', () => {
  it('relays the limit and after query params to the scraper', async () => {
    const posts = [
      {
        id: 'abc',
        title: 'T',
        selftext: '',
        author: 'u',
        score: 5,
        created_utc: 1,
      },
    ];
    scraper.fetchTopPosts.mockResolvedValue({
      posts,
      after: null,
      isInvalid: false,
    });

    const app = createApp(
      scraper as unknown as RedditScraper,
      new Pacer({ minDelayMs: 0, maxDelayMs: 0 }),
    );
    const res = await request(app).get('/top-posts/webdev?limit=10&after=t3_x');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ posts, after: null, isInvalid: false });
    expect(scraper.fetchTopPosts).toHaveBeenCalledWith('webdev', {
      limit: 10,
      after: 't3_x',
    });
  });
});

describe('GET /comments/:subreddit/:postId', () => {
  it('returns the scraper comments', async () => {
    const comments = [
      {
        id: 'c1',
        body: 'b',
        author: 'a',
        score: 5,
        parent_id: 'postabc',
        created_utc: 100,
      },
    ];
    scraper.fetchPostComments.mockResolvedValue(comments);

    const app = createApp(
      scraper as unknown as RedditScraper,
      new Pacer({ minDelayMs: 0, maxDelayMs: 0 }),
    );
    const res = await request(app).get('/comments/webdev/postabc');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ comments });
    expect(scraper.fetchPostComments).toHaveBeenCalledWith('webdev', 'postabc');
  });
});

describe('GET /comments error handling', () => {
  it('returns 502 when the scraper fails', async () => {
    scraper.fetchPostComments.mockRejectedValue(
      new Error('reddit returned a forbidden page'),
    );

    const app = createApp(
      scraper as unknown as RedditScraper,
      new Pacer({ minDelayMs: 0, maxDelayMs: 0 }),
    );
    const res = await request(app).get('/comments/webdev/postabc');

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'reddit returned a forbidden page' });
  });
});

describe('request logging', () => {
  it('emits ONE JSON request log per request with req, res and statusCode', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc: unknown, cb: () => void): void {
        lines.push(chunk.toString());
        cb();
      },
    });
    scraper.fetchTopPosts.mockResolvedValue({
      posts: [],
      after: null,
      isInvalid: false,
    });

    const app = createApp(
      scraper as unknown as RedditScraper,
      new Pacer({ minDelayMs: 0, maxDelayMs: 0 }),
      pino({ level: 'info' }, stream),
    );
    await request(app).get('/top-posts/webdev').expect(200);

    const requestLine = lines
      .map((l) => l.trim())
      .find((l) => l.includes('"req"') && l.includes('"res"'));
    expect(requestLine).toBeDefined();

    const parsed = JSON.parse(requestLine ?? '{}') as {
      req: { method: string; url: string };
      res: { statusCode: number };
    };
    expect(parsed.req).toMatchObject({
      method: 'GET',
      url: '/top-posts/webdev',
    });
    expect(parsed.res).toMatchObject({ statusCode: 200 });
  });
});
