import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { ChannelController } from './channel.controller';
import { ChannelService } from './channel.service';
import { PlaybackService } from './playback.service';
import { QueueService } from './queue.service';
import { InternalAuthGuard } from './internal-auth.guard';
import { ConfigureChannelDto } from './dto/configure-channel.dto';
import { SubscribeSubredditDto } from './dto/subscribe-subreddit.dto';
import { Request } from 'express';

describe('ChannelController', () => {
  let controller: ChannelController;

  const mockChannelService = {
    getUserChannels: jest.fn(),
    getAllChannels: jest.fn(),
    configureChannel: jest.fn(),
    subscribeToSubreddit: jest.fn(),
    unsubscribeFromSubreddit: jest.fn(),
    getSubscribedSubreddits: jest.fn(),
  };

  const mockPlaybackService = {
    getNextTrack: jest.fn(),
  };

  const mockQueueService = {
    findPendingTopicSegment: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChannelController],
      providers: [
        { provide: ChannelService, useValue: mockChannelService },
        { provide: PlaybackService, useValue: mockPlaybackService },
        { provide: QueueService, useValue: mockQueueService },
      ],
    })
      .overrideGuard(InternalAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ChannelController>(ChannelController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getUserChannels', () => {
    it('should return user channels', async () => {
      const channels = [
        { id: '1', name: 'Public', visibility: 'public', ownerId: null },
      ];
      mockChannelService.getUserChannels.mockResolvedValue(channels);

      const req = {
        user: { id: 'user-1' },
      } as Request & { user: { id: string } };
      const result = await controller.getUserChannels(req);

      expect(mockChannelService.getUserChannels).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(channels);
    });
  });

  describe('getActiveChannels', () => {
    it('should return all channels for streaming discovery', async () => {
      const channels = [
        { id: '1', name: 'Channel 1', visibility: 'public', ownerId: null },
      ];
      mockChannelService.getAllChannels.mockResolvedValue(channels);

      const result = await controller.getActiveChannels();

      expect(mockChannelService.getAllChannels).toHaveBeenCalled();
      expect(result).toEqual(channels);
    });
  });

  describe('configureChannel', () => {
    it('should configure channel and return response', async () => {
      const dto: ConfigureChannelDto = {
        name: 'My Radio',
        visibility: 'private',
      };
      const channel = {
        id: 'chan-1',
        name: 'My Radio',
        visibility: 'private',
        ownerId: 'user-1',
      };
      mockChannelService.configureChannel.mockResolvedValue(channel);

      const req = {
        user: { id: 'user-1' },
      } as Request & { user: { id: string } };
      const result = await controller.configureChannel(dto, req);

      expect(mockChannelService.configureChannel).toHaveBeenCalledWith(
        dto,
        'user-1',
      );
      expect(result).toEqual(channel);
    });
  });

  describe('subscribeToSubreddit', () => {
    it('should subscribe subreddit to channel', async () => {
      mockChannelService.subscribeToSubreddit.mockResolvedValue(undefined);

      await controller.subscribeToSubreddit('chan-1', {
        subredditName: 'AskReddit',
      });

      expect(mockChannelService.subscribeToSubreddit).toHaveBeenCalledWith(
        'chan-1',
        'AskReddit',
      );
    });
  });

  describe('unsubscribeFromSubreddit', () => {
    it('should unsubscribe subreddit from channel', async () => {
      mockChannelService.unsubscribeFromSubreddit.mockResolvedValue(undefined);

      await controller.unsubscribeFromSubreddit('chan-1', 'AskReddit');

      expect(mockChannelService.unsubscribeFromSubreddit).toHaveBeenCalledWith(
        'chan-1',
        'AskReddit',
      );
    });
  });

  describe('getChannelSubreddits', () => {
    it('should return the channel subreddits from the service', async () => {
      const subreddits = ['askreddit'];
      mockChannelService.getSubscribedSubreddits.mockResolvedValue(subreddits);

      const result = await controller.getChannelSubreddits('chan-1');

      expect(mockChannelService.getSubscribedSubreddits).toHaveBeenCalledWith(
        'chan-1',
      );
      expect(result).toEqual(subreddits);
    });
  });

  describe('getNextTrack', () => {
    it('should return next track metadata from playback service', async () => {
      const track = {
        segmentId: 'seg-1',
        type: 'song',
        filePath: 'song.mp3',
        durationSeconds: 180,
      };
      mockPlaybackService.getNextTrack.mockResolvedValue(track);

      const result = await controller.getNextTrack('chan-1');

      expect(mockPlaybackService.getNextTrack).toHaveBeenCalledWith('chan-1');
      expect(result).toEqual(track);
    });
  });

  describe('getTopics', () => {
    it('should return pending topics for admin inspection', async () => {
      const topic = { id: 'top-1', posts: [] };
      mockQueueService.findPendingTopicSegment.mockResolvedValue(topic);

      const result = await controller.getTopics('chan-1');

      expect(mockQueueService.findPendingTopicSegment).toHaveBeenCalledWith(
        'chan-1',
      );
      expect(result).toEqual(topic);
    });
  });

  describe('SubscribeSubredditDto validation', () => {
    it('rejects a non-string subredditName via the validation pipe', async () => {
      const pipe = new ValidationPipe();
      await expect(
        pipe.transform(
          { subredditName: 123 },
          { type: 'body', metatype: SubscribeSubredditDto },
        ),
      ).rejects.toThrow();
    });

    it('rejects an empty subredditName via the validation pipe', async () => {
      const pipe = new ValidationPipe();
      await expect(
        pipe.transform(
          { subredditName: '' },
          { type: 'body', metatype: SubscribeSubredditDto },
        ),
      ).rejects.toThrow();
    });
  });
});
