import { Subreddit } from './subreddit.entity';

describe('Subreddit Entity', () => {
  it('should trim and lowercase the name during hook execution', () => {
    const subreddit = new Subreddit();
    subreddit.name = '  AskReddit  ';

    // Call the normalization method which will be decorated with @BeforeInsert and @BeforeUpdate
    subreddit.normalizeName();

    expect(subreddit.name).toBe('askreddit');
  });
});
