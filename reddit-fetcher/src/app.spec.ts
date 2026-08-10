import request from 'supertest';
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
