import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueueGeneratorService } from './queue-generator.service';
import { ChannelPlaylistItem } from './entities/channel-playlist-item.entity';
import { ChannelSubreddit } from './entities/channel-subreddit.entity';
import { ChannelPostProgress } from './entities/channel-post-progress.entity';
import { Post } from '../feed/entities/post.entity';
import { RadioService } from '../radio/radio.service';
import { MediaService } from '../media/media.service';
import { ScraperService } from '../feed/scraper.service';

describe('QueueGeneratorService', () => {
  let service: QueueGeneratorService;

  const mockPlaylistItemRepo = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockSubredditRepo = {
    find: jest.fn(),
  };

  const mockProgressRepo = {
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockPostRepo = {
    find: jest.fn(),
  };

  const mockRadioService = {
    getSegmentVoiceTrack: jest.fn(),
  };

  const mockMediaService = {
    getRandomMusic: jest.fn(),
    getRandomAd: jest.fn(),
    getRandomJingle: jest.fn(),
  };

  const mockScraperService = {
    scrapeSubreddit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueGeneratorService,
        {
          provide: getRepositoryToken(ChannelPlaylistItem),
          useValue: mockPlaylistItemRepo,
        },
        {
          provide: getRepositoryToken(ChannelSubreddit),
          useValue: mockSubredditRepo,
        },
        {
          provide: getRepositoryToken(ChannelPostProgress),
          useValue: mockProgressRepo,
        },
        { provide: getRepositoryToken(Post), useValue: mockPostRepo },
        { provide: RadioService, useValue: mockRadioService },
        { provide: MediaService, useValue: mockMediaService },
        { provide: ScraperService, useValue: mockScraperService },
      ],
    }).compile();

    service = module.get<QueueGeneratorService>(QueueGeneratorService);
    jest.clearAllMocks();

    mockMediaService.getRandomJingle.mockResolvedValue({
      filePath: 'jingle.mp3',
      durationSeconds: 5,
    });
    mockMediaService.getRandomMusic.mockResolvedValue({
      filePath: 'song.mp3',
      durationSeconds: 180,
    });
    mockMediaService.getRandomAd.mockResolvedValue({
      filePath: 'ad.mp3',
      durationSeconds: 30,
    });
    mockRadioService.getSegmentVoiceTrack.mockResolvedValue({
      filePath: 'tts.mp3',
      durationSeconds: 60,
    });
    mockPlaylistItemRepo.create.mockImplementation(
      (dto) => dto as ChannelPlaylistItem,
    );
    mockPlaylistItemRepo.save.mockImplementation((item) =>
      Promise.resolve({
        id: 'uuid-1',
        ...(item as Record<string, unknown>),
      } as ChannelPlaylistItem),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('bufferAhead (Lazy & Reactive Scraping)', () => {
    it('should trigger scraping if subreddit lastScrapedAt is null', async () => {
      const channelId = 'chan-1';
      mockPlaylistItemRepo.count.mockResolvedValue(0);
      mockSubredditRepo.find.mockResolvedValue([
        {
          subredditId: 'sub-1',
          subreddit: { name: 'AskReddit', lastScrapedAt: null },
        },
      ]);
      mockProgressRepo.find.mockResolvedValue([]);
      mockPostRepo.find.mockResolvedValue([]);
      mockScraperService.scrapeSubreddit.mockResolvedValue(undefined);

      await service.bufferAhead(channelId);

      expect(mockScraperService.scrapeSubreddit).toHaveBeenCalledWith(
        'AskReddit',
      );
    });

    it('should trigger scraping if lastScrapedAt is older than 72 hours', async () => {
      const channelId = 'chan-1';
      const staleDate = new Date(Date.now() - 73 * 60 * 60 * 1000); // 73 hours ago
      mockPlaylistItemRepo.count.mockResolvedValue(0);
      mockSubredditRepo.find.mockResolvedValue([
        {
          subredditId: 'sub-1',
          subreddit: { name: 'news', lastScrapedAt: staleDate },
        },
      ]);
      mockProgressRepo.find.mockResolvedValue([]);
      mockPostRepo.find.mockResolvedValue([]);

      await service.bufferAhead(channelId);

      expect(mockScraperService.scrapeSubreddit).toHaveBeenCalledWith('news');
    });

    it('should trigger scraping if channel has 0 unplayed posts (exhausted)', async () => {
      const channelId = 'chan-1';
      const freshDate = new Date(Date.now() - 5 * 60 * 60 * 1000); // 5 hours ago (fresh)
      mockPlaylistItemRepo.count.mockResolvedValue(0);
      mockSubredditRepo.find.mockResolvedValue([
        {
          subredditId: 'sub-1',
          subreddit: { id: 'sub-1', name: 'pics', lastScrapedAt: freshDate },
        },
      ]);
      // We have post-1, but channel already completed post-1 (exhausted!)
      mockProgressRepo.find.mockResolvedValue([{ postId: 'post-1' }]);
      mockPostRepo.find.mockResolvedValue([
        { id: 'post-1', subredditId: 'sub-1', title: 'pics title' },
      ]);

      await service.bufferAhead(channelId);

      expect(mockScraperService.scrapeSubreddit).toHaveBeenCalledWith('pics');
    });

    it('should NOT trigger scraping if cache is fresh and there are unplayed posts', async () => {
      const channelId = 'chan-1';
      const freshDate = new Date(Date.now() - 5 * 60 * 60 * 1000); // 5 hours ago
      mockPlaylistItemRepo.count.mockResolvedValue(0);
      mockSubredditRepo.find.mockResolvedValue([
        {
          subredditId: 'sub-1',
          subreddit: { id: 'sub-1', name: 'funny', lastScrapedAt: freshDate },
        },
      ]);
      // post-1 exists, and progress has no record of post-1 (unplayed exists)
      mockProgressRepo.find.mockResolvedValue([]);
      mockPostRepo.find.mockResolvedValue([
        { id: 'post-1', subredditId: 'sub-1', title: 'funny post title' },
      ]);

      await service.bufferAhead(channelId);

      expect(mockScraperService.scrapeSubreddit).not.toHaveBeenCalled();
    });
  });

  describe('bufferAhead', () => {
    it('should generate media items and queue a talk item if queue is low', async () => {
      const channelId = 'chan-1';

      // Mock queue has 0 future items, so it needs to generate more
      mockPlaylistItemRepo.count.mockResolvedValue(0);
      mockPlaylistItemRepo.findOne.mockResolvedValue(null);

      // Mock subscription to subreddit 'sub-1'
      mockSubredditRepo.find.mockResolvedValue([{ subredditId: 'sub-1' }]);

      // Mock 0 completed post progress
      mockProgressRepo.find.mockResolvedValue([]);

      // Mock 2 available posts (1 SpaceX, 1 SpaceX repost) in that subreddit
      const post1 = {
        id: 'post-1',
        title: 'SpaceX Falcon Heavy launch',
        score: 100,
        subredditId: 'sub-1',
      } as Post;
      const post2 = {
        id: 'post-2',
        title: 'SpaceX Falcon Heavy launch delayed',
        score: 80,
        subredditId: 'sub-1',
      } as Post;
      mockPostRepo.find.mockResolvedValue([post1, post2]);

      // Mock MediaService helper responses
      mockMediaService.getRandomJingle.mockResolvedValue({
        filePath: 'jingle.mp3',
        durationSeconds: 5,
      });
      mockMediaService.getRandomMusic.mockResolvedValue({
        filePath: 'song.mp3',
        durationSeconds: 180,
      });
      mockMediaService.getRandomAd.mockResolvedValue({
        filePath: 'ad.mp3',
        durationSeconds: 30,
      });

      // Mock RadioService voice generation
      mockRadioService.getSegmentVoiceTrack.mockResolvedValue({
        filePath: 'tts.mp3',
        durationSeconds: 60,
      });

      const mockSavedItems: ChannelPlaylistItem[] = [];
      mockPlaylistItemRepo.create.mockImplementation(
        (dto) => dto as ChannelPlaylistItem,
      );
      mockPlaylistItemRepo.save.mockImplementation((item) => {
        mockSavedItems.push(item as ChannelPlaylistItem);
        return Promise.resolve({
          id: 'uuid-' + mockSavedItems.length,
          ...(item as Record<string, unknown>),
        } as ChannelPlaylistItem);
      });

      await service.bufferAhead(channelId);

      expect(mockPlaylistItemRepo.count).toHaveBeenCalled();
      expect(mockMediaService.getRandomJingle).toHaveBeenCalled();
      expect(mockMediaService.getRandomMusic).toHaveBeenCalled();
      expect(mockMediaService.getRandomAd).toHaveBeenCalled();

      // Check that RadioService is called with clustered posts (both post-1 and post-2 because they are similar)
      expect(mockRadioService.getSegmentVoiceTrack).toHaveBeenCalledWith(
        expect.arrayContaining(['post-1', 'post-2']),
      );

      // Check progress repo creates progress entries for BOTH posts to prevent replaying
      expect(mockProgressRepo.create).toHaveBeenCalledWith({
        channelId,
        postId: 'post-1',
      });
      expect(mockProgressRepo.create).toHaveBeenCalledWith({
        channelId,
        postId: 'post-2',
      });

      // Check queued items order:
      expect(mockSavedItems[0].type).toBe('jingle');
      expect(mockSavedItems[0].status).toBe('ready');

      expect(mockSavedItems[1].type).toBe('talk');
      // Talk item's topicId should store the primary post ID ('post-1')
      expect(mockSavedItems[1].topicId).toBe('post-1');
    });
  });
});
