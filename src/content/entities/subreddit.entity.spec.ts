import { Subreddit } from './subreddit.entity';

describe('SubredditEntity Invariants & Encapsulation', () => {
  it('normalizes and validates subreddit name', () => {
    const sub = new Subreddit('  AskReddit  ');
    expect(sub.name).toBe('askreddit');

    sub.name = '  News  ';
    expect(sub.name).toBe('news');

    expect(() => new Subreddit('')).toThrow('Subreddit name cannot be empty');
    expect(() => new Subreddit('   ')).toThrow(
      'Subreddit name cannot be empty',
    );

    const valid = new Subreddit('technology');
    expect(() => {
      valid.name = '  ';
    }).toThrow('Subreddit name cannot be empty');
  });

  it('encapsulates scrape metadata and enforces read-only createdAt', () => {
    const sub = new Subreddit('askscience');
    expect(sub.createdAt).toBeUndefined();
    expect(sub.lastScrapedAt).toBeNull();
    expect(sub.scrapeStartedAt).toBeNull();
    expect(sub.scrapeCooldownUntil).toBeNull();

    const now = new Date();
    sub.lastScrapedAt = now;
    sub.scrapeStartedAt = now;
    sub.scrapeCooldownUntil = now;
    expect(sub.lastScrapedAt).toBe(now);
    expect(sub.scrapeStartedAt).toBe(now);
    expect(sub.scrapeCooldownUntil).toBe(now);

    const persistedDate = new Date('2026-01-15T00:00:00Z');
    const persisted = new Subreddit('worldnews', 'sub-uuid', persistedDate);
    expect(persisted.createdAt).toBe(persistedDate);
    expect(persisted.id).toBe('sub-uuid');
  });
});
