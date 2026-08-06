import request from 'supertest';
import { createApp } from './app';
import { RedditScraper } from './scraper';
import { Pacer } from './pacer';

jest.mock('./scraper', () => ({
  RedditScraper: jest.fn().mockImplementation(() => ({
    fetchTopPosts: jest.fn(),
  })),
}));

const RedditScraperMock = RedditScraper as jest.MockedClass<typeof RedditScraper>;

describe('GET /top-posts/:subreddit', () => {
  it('relays the scraper result with the limit query param', async () => {
    const scraper = new RedditScraperMock('ws://unused');
    const posts = [
      { id: 'abc', title: 'T', selftext: '', author: 'u', score: 5, created_utc: 1 },
    ];
    (scraper.fetchTopPosts as jest.Mock).mockResolvedValue({
      posts,
      isInvalid: false,
    });

    const app = createApp(scraper, new Pacer());
    const res = await request(app).get('/top-posts/webdev?limit=10');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ posts, isInvalid: false });
    expect(scraper.fetchTopPosts).toHaveBeenCalledWith('webdev', 10);
  });
});