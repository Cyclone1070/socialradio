import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SubscribeSubredditDto } from './subscribe-subreddit.dto';

describe('SubscribeSubredditDto', () => {
  it('accepts valid subreddit name, trims, and normalizes to lowercase', async () => {
    const dto = plainToInstance(SubscribeSubredditDto, {
      subredditName: '  AskReddit  ',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.subredditName).toBe('askreddit');
  });

  it('rejects empty or whitespace-only subreddit name', async () => {
    const dto = plainToInstance(SubscribeSubredditDto, {
      subredditName: '   ',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('subredditName');
  });
});
