import { createApp } from './app';
import { Pacer } from './pacer';
import { RedditScraper } from './scraper';

const wsEndpoint = process.env.BROWSERLESS_WS_URL;
const port = Number(process.env.PORT ?? 3001);

if (!wsEndpoint) {
  throw new Error('BROWSERLESS_WS_URL is not configured');
}

const app = createApp(new RedditScraper(wsEndpoint), new Pacer());
app.listen(port, () => {
  console.log(`reddit-fetcher listening on :${port}`);
});
