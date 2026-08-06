import express from 'express';
import { Pacer } from './pacer';
import { RedditScraper } from './scraper';

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * HTTP surface of the fetcher. Every handler routes through the single
 * Pacer, so all Reddit traffic out of this container is globally spaced
 * 1–2s apart regardless of how many backend replicas call in.
 */
export function createApp(
  scraper: RedditScraper,
  pacer: Pacer,
): express.Express {
  const app = express();

  app.get('/top-posts/:subreddit', (req, res) => {
    const subreddit = req.params.subreddit;
    const parsedLimit = Number(req.query.limit ?? 100);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 100;

    void pacer
      .run(async () => {
        try {
          const result = await scraper.fetchTopPosts(subreddit, limit);
          res.json(result);
        } catch (err) {
          console.error('[top-posts]', subreddit, err);
          res.status(502).json({ error: errMessage(err) });
        }
      })
      .catch(() => undefined);
  });

  app.get('/comments/:subreddit/:postId', (req, res) => {
    const { subreddit, postId } = req.params;

    void pacer
      .run(async () => {
        try {
          const comments = await scraper.fetchPostComments(
            subreddit,
            postId,
          );
          res.json({ comments });
        } catch (err) {
          res.status(502).json({ error: errMessage(err) });
        }
      })
      .catch(() => undefined);
  });

  app.get('/exists/:subreddit', (req, res) => {
    const subreddit = req.params.subreddit;

    void pacer
      .run(async () => {
        try {
          const valid = await scraper.exists(subreddit);
          res.json({ valid });
        } catch (err) {
          res.status(502).json({ error: errMessage(err) });
        }
      })
      .catch(() => undefined);
  });

  return app;
}