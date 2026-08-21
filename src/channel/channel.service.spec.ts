import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { EntityManager } from '@mikro-orm/postgresql';
import { NotFoundException } from '@nestjs/common';
import { ChannelService } from './channel.service';
import { Channel, SubredditRef } from './entities/channel.entity';
import { ChannelSchema } from '../infrastructure/database/schemas/channel.schema';
import { ContentContract } from '../domain/contracts';

describe('ChannelService', () => {
  let service: ChannelService;

  const mockChannelRepo = {
    find: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
  };

  const mockEntityManager = {
    persist: jest.fn().mockReturnThis(),
    flush: jest.fn(),
    getReference: jest.fn((_cls, id: string) => ({ id, name: 'sub' })),
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
        {
          provide: getRepositoryToken(ChannelSchema),
          useValue: mockChannelRepo,
        },
        { provide: EntityManager, useValue: mockEntityManager },
        { provide: ContentContract, useValue: mockContentContract },
      ],
    }).compile();

    service = module.get<ChannelService>(ChannelService);
    jest.clearAllMocks();
    mockEntityManager.persist.mockReturnThis();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('configureChannel', () => {
    it('should create and return a private channel', async () => {
      const dto = { name: 'My Radio', visibility: 'private' as const };
      const ownerId = 'user-1';

      mockEntityManager.persist.mockImplementation((chan: Channel) => {
        chan.id = 'chan-1';
        return mockEntityManager;
      });

      const result = await service.configureChannel(dto, ownerId);

      expect(mockEntityManager.persist).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Radio',
          visibility: 'private',
          ownerId,
        }),
      );
      expect(mockEntityManager.flush).toHaveBeenCalled();
      expect(result.id).toBe('chan-1');
      expect(result.name).toBe('My Radio');
      expect(result.visibility).toBe('private');
    });
  });

  describe('subscribeToSubreddit', () => {
    it('should throw NotFoundException if channel does not exist', async () => {
      mockChannelRepo.findOne.mockResolvedValue(null);

      await expect(
        service.subscribeToSubreddit('nonexistent-chan', 'pics'),
      ).rejects.toThrow(NotFoundException);

      expect(mockChannelRepo.findOne).toHaveBeenCalledWith(
        { id: 'nonexistent-chan' },
        { populate: ['subreddits'] },
      );
    });

    it('should normalize name, check API, save Subreddit and add to channel subreddits', async () => {
      const channelId = 'chan-1';
      const subInputName = '  AskReddit  ';
      const normalizedName = 'askreddit';
      const subreddit = { id: 'sub-1', name: normalizedName };

      const channel = Object.assign(new Channel(), {
        id: channelId,
        subreddits: {
          getItems: jest.fn().mockReturnValue([] as SubredditRef[]),
          add: jest.fn(),
        },
      });

      mockChannelRepo.findOne.mockResolvedValue(channel);
      mockContentContract.getSubredditByName.mockResolvedValue(subreddit);

      await service.subscribeToSubreddit(channelId, subInputName);

      expect(mockContentContract.getSubredditByName).toHaveBeenCalledWith(
        normalizedName,
      );
      expect(channel.subreddits.add).toHaveBeenCalled();
      expect(mockEntityManager.flush).toHaveBeenCalled();
    });

    it('should be idempotent if channel is already subscribed', async () => {
      const channelId = 'chan-1';
      const subName = 'askreddit';
      const subreddit = { id: 'sub-1', name: subName };

      const channel = Object.assign(new Channel(), {
        id: channelId,
        subreddits: {
          getItems: jest
            .fn()
            .mockReturnValue([
              { id: 'sub-1', name: subName },
            ] as SubredditRef[]),
          add: jest.fn(),
        },
      });

      mockChannelRepo.findOne.mockResolvedValue(channel);
      mockContentContract.getSubredditByName.mockResolvedValue(subreddit);

      await service.subscribeToSubreddit(channelId, subName);

      expect(channel.subreddits.add).not.toHaveBeenCalled();
    });
  });

  describe('getSubscribedSubreddits', () => {
    it('should return the subreddits a channel is subscribed to', async () => {
      const channelId = 'chan-1';
      const channel = Object.assign(new Channel(), {
        id: channelId,
        subreddits: {
          getItems: jest
            .fn()
            .mockReturnValue([
              { id: 'sub-1', name: 'askreddit' },
            ] as SubredditRef[]),
        },
      });
      mockChannelRepo.findOne.mockResolvedValue(channel);

      const result = await service.getSubscribedSubreddits(channelId);

      expect(result).toEqual([{ id: 'sub-1', name: 'askreddit' }]);
    });
  });

  describe('unsubscribeFromSubreddit', () => {
    it('should normalize subreddit name, find it and delete subscription', async () => {
      const channelId = 'chan-1';
      const subNameInput = '  AskReddit  ';
      const normalizedName = 'askreddit';
      const subreddit = { id: 'sub-1', name: normalizedName };

      const subItem: SubredditRef = { id: 'sub-1', name: normalizedName };
      const channel = Object.assign(new Channel(), {
        id: channelId,
        subreddits: {
          getItems: jest.fn().mockReturnValue([subItem]),
          remove: jest.fn(),
        },
      });

      mockContentContract.getSubredditByName.mockResolvedValue(subreddit);
      mockChannelRepo.findOne.mockResolvedValue(channel);

      await service.unsubscribeFromSubreddit(channelId, subNameInput);

      expect(mockContentContract.getSubredditByName).toHaveBeenCalledWith(
        normalizedName,
      );
      expect(channel.subreddits.remove).toHaveBeenCalledWith(subItem);
      expect(mockEntityManager.flush).toHaveBeenCalled();
    });

    it('should throw NotFoundException if subreddit is not registered', async () => {
      mockContentContract.getSubredditByName.mockResolvedValue(null);

      await expect(
        service.unsubscribeFromSubreddit('chan-1', 'unknown'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
