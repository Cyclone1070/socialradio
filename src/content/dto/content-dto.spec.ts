import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ScrapeSubredditDto } from './scrape-subreddit.dto';

describe('Content DTO Validation & Transformation', () => {
  describe('ScrapeSubredditDto', () => {
    it('accepts valid subreddit name, trims, and lowercases', async () => {
      const dto = plainToInstance(ScrapeSubredditDto, {
        subredditName: '  Technology  ',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.subredditName).toBe('technology');
    });

    it('rejects empty or whitespace-only subreddit name', async () => {
      const dto = plainToInstance(ScrapeSubredditDto, {
        subredditName: '    ',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('subredditName');
    });
  });
});
