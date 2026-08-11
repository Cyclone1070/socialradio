import express from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { Pacer } from './pacer';
import { RedditScraper } from './scraper';

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * HTTP surface of the fetcher. Every handler routes through the single
 * Pacer: up to 5 concurrent requests, same-subreddit requests sequential,
 * a random 500–1000ms delay per request. Every request emits ONE JSON log
 * line (pino-http) with timing + status; handler errors go through the
 * same logger so all output stays structured on stdout.
 */
export function createApp(
  scraper: RedditScraper,
  pacer: Pacer,
  logger: pino.Logger = pino(),
): express.Express {
  const app = express();
  app.use(pinoHttp({ logger }));

  app.get('/top-posts/:subreddit', (req, res) => {
    const subreddit = req.params.subreddit;
    const parsedLimit = Number(req.query.limit ?? 100);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 100;
    const after =
      typeof req.query.after === 'string' && req.query.after.length > 0
        ? req.query.after
        : undefined;

    void pacer
      .run(subreddit, async () => {
        try {
          const result = await scraper.fetchTopPosts(subreddit, {
            limit,
            after,
          });
          res.json(result);
        } catch (err) {
          logger.error({ err, subreddit }, 'top-posts failed');
          res.status(502).json({ error: errMessage(err) });
        }
      })
      .catch(() => undefined);
  });

  app.get('/comments/:subreddit/:postId', (req, res) => {
    const { subreddit, postId } = req.params;

    void pacer
      .run(subreddit, async () => {
        try {
          const comments = await scraper.fetchPostComments(subreddit, postId);
          res.json({ comments });
        } catch (err) {
          logger.error({ err, subreddit, postId }, 'comments failed');
          res.status(502).json({ error: errMessage(err) });
        }
      })
      .catch(() => undefined);
  });

  app.get('/exists/:subreddit', (req, res) => {
    const subreddit = req.params.subreddit;

    void pacer
      .run(subreddit, async () => {
        try {
          const valid = await scraper.exists(subreddit);
          res.json({ valid });
        } catch (err) {
          logger.error({ err, subreddit }, 'exists failed');
          res.status(502).json({ error: errMessage(err) });
        }
      })
      .catch(() => undefined);
  });

  return app;
}
