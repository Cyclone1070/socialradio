import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChannelService } from './channel.service';
import { Channel } from './entities/channel.entity';
import { ChannelSubreddit } from './entities/channel-subreddit.entity';
import { Subreddit } from '../domain/entities/subreddit.entity';

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
      const dto = { name: 'My Radio', type: 'private' as const };
      const ownerId = 'user-1';
      const channel = {
        id: 'chan-1',
        name: 'My Radio',
        type: 'private',
        ownerId,
        isPaused: true,
        createdAt: new Date(),
      };

      mockChannelRepo.create.mockReturnValue(channel);
      mockChannelRepo.save.mockResolvedValue(channel);

      const result = await service.configureChannel(dto, ownerId);

      expect(mockChannelRepo.create).toHaveBeenCalledWith({
        name: 'My Radio',
        type: 'private',
        ownerId,
      });
      expect(mockChannelRepo.save).toHaveBeenCalledWith(channel);
      expect(result).toEqual({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        ownerId: channel.ownerId,
        isPaused: channel.isPaused,
        createdAt: channel.createdAt,
      });
    });
  });

  describe('subscribeToSubreddit', () => {
    it('should find/create Subreddit and create subscription mapping', async () => {
      const channelId = 'chan-1';
      const subName = 'AskReddit';
      const subreddit = { id: 'sub-1', name: subName };

      mockSubredditRepo.findOneBy.mockResolvedValue(null);
      mockSubredditRepo.create.mockReturnValue(subreddit);
      mockSubredditRepo.save.mockResolvedValue(subreddit);

      const subscription = { channelId, subredditId: subreddit.id };
      mockChannelSubredditRepo.create.mockReturnValue(subscription);
      mockChannelSubredditRepo.save.mockResolvedValue(subscription);

      await service.subscribeToSubreddit(channelId, subName);

      expect(mockSubredditRepo.findOneBy).toHaveBeenCalledWith({
        name: subName,
      });
      expect(mockChannelSubredditRepo.create).toHaveBeenCalledWith({
        channelId,
        subredditId: 'sub-1',
      });
      expect(mockChannelSubredditRepo.save).toHaveBeenCalled();
    });
  });
});
