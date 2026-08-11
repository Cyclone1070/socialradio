import pino from 'pino';
import { createApp } from './app';
import { Pacer } from './pacer';
import { RedditScraper } from './scraper';

const wsEndpoint = process.env.BROWSERLESS_WS_URL;
const port = Number(process.env.PORT ?? 3001);

if (!wsEndpoint) {
  throw new Error('BROWSERLESS_WS_URL is not configured');
}

// LOG_LEVEL controls verbosity; LOG_PRETTY=1 switches to human-readable
// output for local development (JSON stays the default for containers).
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(process.env.LOG_PRETTY === '1'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      }
    : {}),
});

const app = createApp(
  new RedditScraper(wsEndpoint, logger),
  new Pacer(),
  logger,
);
app.listen(port, () => {
  logger.info({ port }, 'reddit-fetcher listening');
});
