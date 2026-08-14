import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChannelService } from './channel.service';
import { Channel } from './entities/channel.entity';
import { ChannelSubreddit } from './entities/channel-subreddit.entity';
import { ContentContract } from '../domain/contracts';

describe('ChannelService', () => {
  let service: ChannelService;

  const mockChannelRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOneBy: jest.fn(),
  };

  const mockChannelSubredditRepo = {
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    findOneBy: jest.fn(),
    find: jest.fn(),
  };

  const mockContentContract = {
    getSubredditByName: jest.fn(),
    getSubredditsByIds: jest.fn(),
    scrapeSubreddit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelService,
        { provide: getRepositoryToken(Channel), useValue: mockChannelRepo },
        {
          provide: getRepositoryToken(ChannelSubreddit),
          useValue: mockChannelSubredditRepo,
        },
        { provide: ContentContract, useValue: mockContentContract },
      ],
    }).compile();

    service = module.get<ChannelService>(ChannelService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('configureChannel', () => {
    it('should create and return a private channel', async () => {
      const dto = { name: 'My Radio', visibility: 'private' as const };
      const ownerId = 'user-1';
      const channel = {
        id: 'chan-1',
        name: 'My Radio',
        visibility: 'private',
        ownerId,
        createdAt: new Date(),
      };

      mockChannelRepo.create.mockReturnValue(channel);
      mockChannelRepo.save.mockResolvedValue(channel);

      const result = await service.configureChannel(dto, ownerId);

      expect(mockChannelRepo.create).toHaveBeenCalledWith({
        name: 'My Radio',
        visibility: 'private',
        ownerId,
      });
      expect(mockChannelRepo.save).toHaveBeenCalledWith(channel);
      expect(result).toEqual({
        id: channel.id,
        name: channel.name,
        visibility: channel.visibility,
        ownerId: channel.ownerId,
        createdAt: channel.createdAt,
      });
    });
  });

  describe('subscribeToSubreddit', () => {
    it('should throw NotFoundException if channel does not exist', async () => {
      mockChannelRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.subscribeToSubreddit('nonexistent-chan', 'pics'),
      ).rejects.toThrow(NotFoundException);

      expect(mockChannelRepo.findOneBy).toHaveBeenCalledWith({
        id: 'nonexistent-chan',
      });
    });

    it('should normalize name, check API, save Subreddit and create subscription mapping', async () => {
      const channelId = 'chan-1';
      const subInputName = '  AskReddit  ';
      const normalizedName = 'askreddit';
      const subreddit = { id: 'sub-1', name: normalizedName };

      mockChannelRepo.findOneBy.mockResolvedValue({ id: channelId });
      mockContentContract.getSubredditByName.mockResolvedValue(subreddit);
      mockChannelSubredditRepo.findOneBy.mockResolvedValue(null);

      const subscription = { channelId, subredditId: subreddit.id };
      mockChannelSubredditRepo.create.mockReturnValue(subscription);
      mockChannelSubredditRepo.save.mockResolvedValue(subscription);

      await service.subscribeToSubreddit(channelId, subInputName);

      expect(mockContentContract.getSubredditByName).toHaveBeenCalledWith(
        normalizedName,
      );
      expect(mockChannelSubredditRepo.create).toHaveBeenCalledWith({
        channelId,
        subredditId: 'sub-1',
      });
      expect(mockChannelSubredditRepo.save).toHaveBeenCalled();
    });

    it('should throw BadRequestException if channel is already subscribed', async () => {
      const channelId = 'chan-1';
      const subName = 'askreddit';
      const subreddit = { id: 'sub-1', name: subName };
      const existingSub = { id: 'sub-chan-1', channelId, subredditId: 'sub-1' };

      mockChannelRepo.findOneBy.mockResolvedValue({ id: channelId });
      mockContentContract.getSubredditByName.mockResolvedValue(subreddit);
      mockChannelSubredditRepo.findOneBy.mockResolvedValue(existingSub);

      await expect(
        service.subscribeToSubreddit(channelId, subName),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getSubscribedSubreddits', () => {
    it('should return the subreddits a channel is subscribed to', async () => {
      const channelId = 'chan-1';
      mockChannelSubredditRepo.find.mockResolvedValue([
        {
          id: 'sub-chan-1',
          channelId,
          subredditId: 'sub-1',
        },
      ]);
      mockContentContract.getSubredditsByIds.mockResolvedValue([
        { id: 'sub-1', name: 'askreddit' },
      ]);

      const result = await service.getSubscribedSubreddits(channelId);

      expect(mockChannelSubredditRepo.find).toHaveBeenCalledWith({
        where: { channelId },
      });
      expect(result).toEqual(['askreddit']);
    });
  });

  describe('unsubscribeFromSubreddit', () => {
    it('should normalize subreddit name, find it and delete subscription', async () => {
      const channelId = 'chan-1';
      const subNameInput = '  AskReddit  ';
      const normalizedName = 'askreddit';
      const subreddit = { id: 'sub-1', name: normalizedName };
      const existingSub = { id: 'sub-chan-1', channelId, subredditId: 'sub-1' };

      mockContentContract.getSubredditByName.mockResolvedValue(subreddit);
      mockChannelSubredditRepo.findOneBy.mockResolvedValue(existingSub);
      mockChannelSubredditRepo.remove.mockResolvedValue(existingSub);

      await service.unsubscribeFromSubreddit(channelId, subNameInput);

      expect(mockContentContract.getSubredditByName).toHaveBeenCalledWith(
        normalizedName,
      );
      expect(mockChannelSubredditRepo.remove).toHaveBeenCalledWith(existingSub);
    });

    it('should throw NotFoundException if subreddit is not registered', async () => {
      mockContentContract.getSubredditByName.mockResolvedValue(null);

      await expect(
        service.unsubscribeFromSubreddit('chan-1', 'unknown'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
