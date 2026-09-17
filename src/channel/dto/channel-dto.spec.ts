import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ConfigureChannelDto } from './configure-channel.dto';
import { SubscribeSubredditDto } from './subscribe-subreddit.dto';

describe('Channel DTO Validation & Transformation', () => {
  describe('ConfigureChannelDto', () => {
    it('accepts valid name and trims whitespace', async () => {
      const dto = plainToInstance(ConfigureChannelDto, {
        name: '  Synthwave Station  ',
        visibility: 'public',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.name).toBe('Synthwave Station');
    });

    it('rejects empty or whitespace-only name', async () => {
      const dto = plainToInstance(ConfigureChannelDto, {
        name: '    ',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('name');
    });

    it('rejects invalid visibility value', async () => {
      const dto = plainToInstance(ConfigureChannelDto, {
        name: 'Valid Name',
        visibility: 'confidential',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('visibility');
    });
  });

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
});
