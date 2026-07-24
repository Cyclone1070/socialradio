import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueueGeneratorService } from './queue-generator.service';
import {
  Segment,
  TalkSegment,
  SongSegment,
  AdSegment,
  JingleSegment,
} from './entities/segment.entity';
import { ChannelSubreddit } from './entities/channel-subreddit.entity';
import { ChannelPostProgress } from './entities/channel-post-progress.entity';
import { Post } from '../feed/entities/post.entity';
import { RadioService } from '../radio/radio.service';
import { MediaService } from '../media/media.service';
import { ScraperService } from '../feed/scraper.service';
import { ChunkerService } from './chunker.service';

describe('QueueGeneratorService', () => {
  let service: QueueGeneratorService;

  const mockSegmentRepo = {
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

  const mockChunker = {
    sliceAndUpload: jest.fn().mockResolvedValue(10),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueGeneratorService,
        {
          provide: getRepositoryToken(Segment),
          useValue: mockSegmentRepo,
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
        { provide: ChunkerService, useValue: mockChunker },
      ],
    }).compile();

    service = module.get<QueueGeneratorService>(QueueGeneratorService);
    jest.clearAllMocks();

    mockMediaService.getRandomJingle.mockResolvedValue({
      filePath: 'jingle.mp3',
      durationSeconds: 5,
      name: 'Jingle Bell',
    });
    mockMediaService.getRandomMusic.mockResolvedValue({
      filePath: 'song.mp3',
      durationSeconds: 180,
      title: 'Title',
      artist: 'Artist',
    });
    mockMediaService.getRandomAd.mockResolvedValue({
      filePath: 'ad.mp3',
      durationSeconds: 30,
      advertiser: 'Advertiser',
    });
    mockRadioService.getSegmentVoiceTrack.mockResolvedValue({
      filePath: 'tts.mp3',
      durationSeconds: 60,
      postIds: ['post-1'],
    });
    mockSegmentRepo.create.mockImplementation((dto): Segment => dto);
    mockSegmentRepo.save.mockImplementation((item): Promise<Segment> =>
      Promise.resolve(item as Segment),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('bufferAhead (Lazy & Reactive Scraping)', () => {
    it('should trigger scraping if subreddit lastScrapedAt is null', async () => {
      const channelId = 'chan-1';
      mockSegmentRepo.count.mockResolvedValue(0);
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
      mockSegmentRepo.count.mockResolvedValue(0);
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
      mockSegmentRepo.count.mockResolvedValue(0);
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
      mockSegmentRepo.count.mockResolvedValue(0);
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
      mockSegmentRepo.count.mockResolvedValue(0);
      mockSegmentRepo.findOne.mockResolvedValue(null);

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
        name: 'Jingle Bell',
      });
      mockMediaService.getRandomMusic.mockResolvedValue({
        filePath: 'song.mp3',
        durationSeconds: 180,
        title: 'Title',
        artist: 'Artist',
      });
      mockMediaService.getRandomAd.mockResolvedValue({
        filePath: 'ad.mp3',
        durationSeconds: 30,
        advertiser: 'Advertiser',
      });

      // Mock RadioService voice generation
      mockRadioService.getSegmentVoiceTrack.mockResolvedValue({
        filePath: 'tts.mp3',
        durationSeconds: 60,
        postIds: ['post-1', 'post-2'],
      });

      const mockSavedItems: Segment[] = [];
      mockSegmentRepo.create.mockImplementation((dto): Segment => dto);
      mockSegmentRepo.save.mockImplementation((item): Promise<Segment> => {
        mockSavedItems.push(item as Segment);
        return Promise.resolve({
          id: 'uuid-' + mockSavedItems.length,
          ...(item as Record<string, unknown>),
        } as unknown as Segment);
      });

      await service.bufferAhead(channelId);

      expect(mockSegmentRepo.count).toHaveBeenCalled();
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

      // Check queued items order and instance type (STI verification):
      expect(mockSavedItems[0] instanceof TalkSegment).toBe(true);

      // Talk item's topicId should store the primary post ID ('post-1')
      expect((mockSavedItems[0] as TalkSegment).topicId).toBe('post-1');
    });

    it('should generate segments following the pattern: [1-2 Talk] -> [1-2 Songs] -> [1-2 Ads] -> [1 Jingle] (Branch: 1 each)', async () => {
      const channelId = 'chan-1';
      mockSegmentRepo.count.mockResolvedValue(0);
      mockSegmentRepo.findOne.mockResolvedValue(null);
      mockSubredditRepo.find.mockResolvedValue([{ subredditId: 'sub-1' }]);
      mockProgressRepo.find.mockResolvedValue([]);
      mockPostRepo.find.mockResolvedValue([
        { id: 'post-1', title: 'Post 1', score: 10, subredditId: 'sub-1' },
      ]);

      // Force getRandomCount to return 1
      jest.spyOn(service, 'getRandomCount').mockReturnValue(1);

      const mockSavedItems: Segment[] = [];
      mockSegmentRepo.save.mockImplementation((item) => {
        mockSavedItems.push(item as Segment);
        return Promise.resolve(item as Segment);
      });

      await service.bufferAhead(channelId);

      // Unique distinct segments by playOrder (1 Talk, 1 Song, 1 Ad, 1 Jingle = 4 total)
      const uniqueItems = Array.from(
        new Set(mockSavedItems.map((item) => item.playOrder)),
      ).map((order) => mockSavedItems.find((item) => item.playOrder === order));

      expect(uniqueItems.length).toBe(4);
      expect(uniqueItems[0]).toBeInstanceOf(TalkSegment);
      expect(uniqueItems[1]).toBeInstanceOf(SongSegment);
      expect(uniqueItems[2]).toBeInstanceOf(AdSegment);
      expect(uniqueItems[3]).toBeInstanceOf(JingleSegment);
    });

    it('should generate segments following the pattern: [1-2 Talk] -> [1-2 Songs] -> [1-2 Ads] -> [1 Jingle] (Branch: 2 each)', async () => {
      const channelId = 'chan-1';
      mockSegmentRepo.count.mockResolvedValue(0);
      mockSegmentRepo.findOne.mockResolvedValue(null);
      mockSubredditRepo.find.mockResolvedValue([{ subredditId: 'sub-1' }]);
      mockProgressRepo.find.mockResolvedValue([]);
      mockPostRepo.find.mockResolvedValue([
        {
          id: 'post-1',
          title: 'Funny cat picture doing a flip',
          score: 10,
          subredditId: 'sub-1',
        },
        {
          id: 'post-2',
          title: 'Quantum Physics breakthrough at CERN laboratory',
          score: 10,
          subredditId: 'sub-1',
        },
      ]);

      // Force getRandomCount to return 2
      jest.spyOn(service, 'getRandomCount').mockReturnValue(2);

      const mockSavedItems: Segment[] = [];
      mockSegmentRepo.save.mockImplementation((item) => {
        mockSavedItems.push(item as Segment);
        return Promise.resolve(item as Segment);
      });

      await service.bufferAhead(channelId);

      // Unique distinct segments by playOrder (2 Talk, 2 Songs, 2 Ads, 1 Jingle = 7 total)
      const uniqueItems = Array.from(
        new Set(mockSavedItems.map((item) => item.playOrder)),
      ).map((order) => mockSavedItems.find((item) => item.playOrder === order));

      expect(uniqueItems.length).toBe(7);
      expect(uniqueItems[0]).toBeInstanceOf(TalkSegment);
      expect(uniqueItems[1]).toBeInstanceOf(TalkSegment);
      expect(uniqueItems[2]).toBeInstanceOf(SongSegment);
      expect(uniqueItems[3]).toBeInstanceOf(SongSegment);
      expect(uniqueItems[4]).toBeInstanceOf(AdSegment);
      expect(uniqueItems[5]).toBeInstanceOf(AdSegment);
      expect(uniqueItems[6]).toBeInstanceOf(JingleSegment);
    });
  });
});
