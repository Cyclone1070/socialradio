/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { ChannelController } from './channel.controller';
import { StorageService } from '../infrastructure/storage/storage.service';
import { ChannelService } from './channel.service';
import { ChannelPlaybackService } from './channel-playback.service';
import { ConfigureChannelDto } from './dto/configure-channel.dto';
import { SubscribeSubredditDto } from './dto/subscribe-subreddit.dto';
import { Request, Response } from 'express';

describe('ChannelController', () => {
  let controller: ChannelController;

  const mockChannelService = {
    getUserChannels: jest.fn(),
    configureChannel: jest.fn(),
    subscribeToSubreddit: jest.fn(),
    unsubscribeFromSubreddit: jest.fn(),
    getSubscribedSubreddits: jest.fn(),
  };

  const mockPlaybackService = {
    getPlaylistManifest: jest.fn(),
  };

  const mockStorageService = {
    exists: jest.fn(),
    read: jest.fn(),
    createReadStream: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChannelController],
      providers: [
        { provide: ChannelService, useValue: mockChannelService },
        {
          provide: ChannelPlaybackService,
          useValue: mockPlaybackService,
        },
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
      ],
    }).compile();

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

  describe('getPlaylistManifest', () => {
    it('should return playlist manifest', async () => {
      const mockRes = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;
      mockPlaybackService.getPlaylistManifest.mockResolvedValue('#EXTM3U');

      await controller.getPlaylistManifest('chan-1', mockRes);

      expect(mockPlaybackService.getPlaylistManifest).toHaveBeenCalledWith(
        'chan-1',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/vnd.apple.mpegurl',
      );
      expect(mockRes.send).toHaveBeenCalledWith('#EXTM3U');
    });
  });

  describe('getAudioChunk', () => {
    it('should stream audio chunk if it exists', async () => {
      const mockRes = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      } as unknown as Response;
      mockStorageService.exists.mockResolvedValue(true);
      mockStorageService.read.mockResolvedValue(Buffer.from('audio'));

      await controller.getAudioChunk('chan-1', 'chunk_1.mp3', mockRes);

      expect(mockStorageService.exists).toHaveBeenCalledWith(
        'channels/chan-1/chunks/chunk_1.mp3',
      );
      expect(mockStorageService.read).toHaveBeenCalledWith(
        'channels/chan-1/chunks/chunk_1.mp3',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'audio/mpeg',
      );
      expect(mockRes.send).toHaveBeenCalledWith(Buffer.from('audio'));
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
