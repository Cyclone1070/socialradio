import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChannelService } from './channel.service';
import { Channel } from './entities/channel.entity';
import { ChannelSubreddit } from './entities/channel-subreddit.entity';
import { Subreddit } from '../domain/entities/subreddit.entity';
import { ScraperService } from '../feed/scraper.service';

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
    delete: jest.fn(),
    findOneBy: jest.fn(),
  };

  const mockSubredditRepo = {
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockScraperService = {
    validateSubreddit: jest.fn(),
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
        { provide: getRepositoryToken(Subreddit), useValue: mockSubredditRepo },
        { provide: ScraperService, useValue: mockScraperService },
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
    it('should normalize name, check API, save Subreddit and create subscription mapping', async () => {
      const channelId = 'chan-1';
      const subInputName = '  AskReddit  ';
      const normalizedName = 'askreddit';
      const subreddit = { id: 'sub-1', name: normalizedName };

      mockSubredditRepo.findOneBy.mockResolvedValue(null);
      mockScraperService.validateSubreddit.mockResolvedValue(true);
      mockSubredditRepo.create.mockReturnValue(subreddit);
      mockSubredditRepo.save.mockResolvedValue(subreddit);

      const subscription = { channelId, subredditId: subreddit.id };
      mockChannelSubredditRepo.create.mockReturnValue(subscription);
      mockChannelSubredditRepo.save.mockResolvedValue(subscription);

      await service.subscribeToSubreddit(channelId, subInputName);

      expect(mockSubredditRepo.findOneBy).toHaveBeenCalledWith({
        name: normalizedName,
      });
      expect(mockScraperService.validateSubreddit).toHaveBeenCalledWith(
        normalizedName,
      );
      expect(mockChannelSubredditRepo.create).toHaveBeenCalledWith({
        channelId,
        subredditId: 'sub-1',
      });
      expect(mockChannelSubredditRepo.save).toHaveBeenCalled();
    });

    it('should skip API validation if Subreddit already exists in database', async () => {
      const channelId = 'chan-1';
      const subName = 'pics';
      const subreddit = { id: 'sub-2', name: subName };

      mockSubredditRepo.findOneBy.mockResolvedValue(subreddit);

      const subscription = { channelId, subredditId: subreddit.id };
      mockChannelSubredditRepo.create.mockReturnValue(subscription);
      mockChannelSubredditRepo.save.mockResolvedValue(subscription);

      await service.subscribeToSubreddit(channelId, subName);

      expect(mockSubredditRepo.findOneBy).toHaveBeenCalledWith({
        name: subName,
      });
      expect(mockScraperService.validateSubreddit).not.toHaveBeenCalled();
      expect(mockChannelSubredditRepo.create).toHaveBeenCalledWith({
        channelId,
        subredditId: 'sub-2',
      });
    });

    it('should throw BadRequestException if Subreddit validation returns false', async () => {
      const channelId = 'chan-1';
      const subName = 'nonexistent';

      mockSubredditRepo.findOneBy.mockResolvedValue(null);
      mockScraperService.validateSubreddit.mockResolvedValue(false);

      await expect(
        service.subscribeToSubreddit(channelId, subName),
      ).rejects.toThrow(BadRequestException);

      expect(mockSubredditRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribeFromSubreddit', () => {
    it('should normalize subreddit name, find it and delete subscription', async () => {
      const channelId = 'chan-1';
      const subNameInput = '  AskReddit  ';
      const normalizedName = 'askreddit';
      const subreddit = { id: 'sub-1', name: normalizedName };

      mockSubredditRepo.findOneBy.mockResolvedValue(subreddit);
      mockChannelSubredditRepo.delete.mockResolvedValue({ affected: 1 });

      await service.unsubscribeFromSubreddit(channelId, subNameInput);

      expect(mockSubredditRepo.findOneBy).toHaveBeenCalledWith({
        name: normalizedName,
      });
      expect(mockChannelSubredditRepo.delete).toHaveBeenCalledWith({
        channelId,
        subredditId: 'sub-1',
      });
    });

    it('should throw NotFoundException if subreddit is not registered', async () => {
      mockSubredditRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.unsubscribeFromSubreddit('chan-1', 'unknown'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
