export class Subreddit {
  id!: string;
  name!: string;
  lastScrapedAt: Date | null = null;
  scrapeStartedAt: Date | null = null;
  scrapeCooldownUntil: Date | null = null;
  createdAt: Date = new Date();
}
