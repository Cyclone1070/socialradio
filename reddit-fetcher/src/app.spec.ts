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

const scraper: { fetchTopPosts: jest.Mock } = {
  fetchTopPosts: jest.fn(),
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
