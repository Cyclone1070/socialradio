import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueueService } from './queue.service';
import { Segment } from './entities/segment.entity';
import { ChannelSubreddit } from './entities/channel-subreddit.entity';
import { ChannelPostProgress } from './entities/channel-post-progress.entity';
import {
  ContentContract,
  ScriptContract,
  VoiceContract,
} from '../domain/contracts';
import { MediaService } from '../media/media.service';

describe('QueueService', () => {
  let service: QueueService;

  const mockSegmentRepo = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockChannelSubredditRepo = {
    find: jest.fn(),
  };

  const mockProgressRepo = {
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockContentContract = {
    getPostData: jest.fn(),
    getPostsBySubredditIds: jest.fn(),
    getCommentsByPostIds: jest.fn(),
    getSubredditsByIds: jest.fn(),
    getSubredditByName: jest.fn(),
    scrapeSubreddit: jest.fn(),
  };

  const mockScriptContract = {
    generateScript: jest.fn(),
  };

  const mockVoiceContract = {
    synthesizeScript: jest.fn(),
  };

  const mockMediaService = {
    getRandomMusic: jest.fn(),
    getRandomAd: jest.fn(),
    getRandomJingle: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        {
          provide: getRepositoryToken(Segment),
          useValue: mockSegmentRepo,
        },
        {
          provide: getRepositoryToken(ChannelSubreddit),
          useValue: mockChannelSubredditRepo,
        },
        {
          provide: getRepositoryToken(ChannelPostProgress),
          useValue: mockProgressRepo,
        },
        { provide: MediaService, useValue: mockMediaService },
        { provide: ContentContract, useValue: mockContentContract },
        { provide: ScriptContract, useValue: mockScriptContract },
        { provide: VoiceContract, useValue: mockVoiceContract },
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
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
    mockContentContract.getCommentsByPostIds.mockResolvedValue([]);
    mockScriptContract.generateScript.mockResolvedValue('Mock script text');
    mockVoiceContract.synthesizeScript.mockResolvedValue({
      filePath: 'tts.mp3',
      durationSeconds: 60,
    });
    mockSegmentRepo.create.mockImplementation((dto): Segment => dto);
    mockSegmentRepo.save.mockImplementation((item): Promise<Segment> =>
      Promise.resolve(item as Segment),
    );
    mockProgressRepo.create.mockImplementation(
      (dto: ChannelPostProgress): ChannelPostProgress => dto,
    );
    mockProgressRepo.save.mockImplementation(
      (dto: ChannelPostProgress): Promise<ChannelPostProgress> =>
        Promise.resolve(dto),
    );
  });

  function setupChannelSubreddits(
    subs: Array<{
      id?: string;
      subredditId?: string;
      name: string;
      lastScrapedAt: Date | null;
    }>,
  ) {
    const formatted = subs.map((s, idx) => ({
      id: s.id || s.subredditId || `sub-${idx + 1}`,
      name: s.name,
      lastScrapedAt: s.lastScrapedAt,
      createdAt: new Date(),
    }));
    mockChannelSubredditRepo.find.mockResolvedValue(
      formatted.map((s) => ({
        channelId: 'chan-1',
        subredditId: s.id,
      })),
    );
    mockContentContract.getSubredditsByIds.mockResolvedValue(formatted);
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('bufferAhead (Lazy & Reactive Scraping)', () => {
    it('should trigger scraping if subreddit lastScrapedAt is null', async () => {
      const channelId = 'chan-1';
      mockSegmentRepo.count.mockResolvedValue(0);
      setupChannelSubreddits([
        {
          subredditId: 'sub-1',
          name: 'AskReddit',
          lastScrapedAt: null,
        },
      ]);
      mockProgressRepo.find.mockResolvedValue([]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([]);
      mockContentContract.scrapeSubreddit.mockResolvedValue(undefined);

      await service.bufferAhead(channelId);

      expect(mockContentContract.scrapeSubreddit).toHaveBeenCalledWith(
        'AskReddit',
      );
    });

    it('should NOT trigger scraping at 4 days since the last scrape (7-day window)', async () => {
      const channelId = 'chan-1';
      const nearlyFresh = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
      mockSegmentRepo.count.mockResolvedValue(0);
      setupChannelSubreddits([
        {
          subredditId: 'sub-1',
          name: 'news',
          lastScrapedAt: nearlyFresh,
        },
      ]);
      mockProgressRepo.find.mockResolvedValue([]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([
        { id: 'post-1', subredditId: 'sub-1', title: 'news title' },
      ]);

      await service.bufferAhead(channelId);

      expect(mockContentContract.scrapeSubreddit).not.toHaveBeenCalled();
    });

    it('should trigger scraping if lastScrapedAt is older than 7 days', async () => {
      const channelId = 'chan-1';
      const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      mockSegmentRepo.count.mockResolvedValue(0);
      setupChannelSubreddits([
        {
          subredditId: 'sub-1',
          name: 'news',
          lastScrapedAt: staleDate,
        },
      ]);
      mockProgressRepo.find.mockResolvedValue([]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([]);

      await service.bufferAhead(channelId);

      expect(mockContentContract.scrapeSubreddit).toHaveBeenCalledWith('news');
    });

    it('should trigger scraping if channel has 0 unplayed posts (exhausted)', async () => {
      const channelId = 'chan-1';
      mockSegmentRepo.count.mockResolvedValue(0);
      setupChannelSubreddits([
        {
          subredditId: 'sub-1',
          name: 'funny',
          lastScrapedAt: new Date(),
        },
      ]);
      mockProgressRepo.find.mockResolvedValue([
        { postId: 'post-1' },
        { postId: 'post-2' },
      ]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([
        { id: 'post-1', subredditId: 'sub-1', title: 'funny title 1' },
        { id: 'post-2', subredditId: 'sub-1', title: 'funny title 2' },
      ]);

      await service.bufferAhead(channelId);

      expect(mockContentContract.scrapeSubreddit).toHaveBeenCalledWith('funny');
    });

    it('should run background scrapes sequentially without awaiting in bufferAhead', async () => {
      const channelId = 'chan-1';
      mockSegmentRepo.count.mockResolvedValue(0);
      setupChannelSubreddits([
        {
          subredditId: 'sub-1',
          name: 'sub1',
          lastScrapedAt: null,
        },
      ]);
      mockProgressRepo.find.mockResolvedValue([]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([]);

      let scrapeResolve: () => void;
      const scrapePromise = new Promise<void>((resolve) => {
        scrapeResolve = resolve;
      });
      mockContentContract.scrapeSubreddit.mockReturnValue(scrapePromise);

      await expect(service.bufferAhead(channelId)).resolves.toBeUndefined();
      scrapeResolve!();
    });
  });

  describe('bufferAhead cycle generation', () => {
    it('appends talk segment when topic is found, saves voice track, and marks posts completed', async () => {
      const channelId = 'chan-1';
      setupChannelSubreddits([
        {
          subredditId: 'sub-1',
          name: 'AskReddit',
          lastScrapedAt: new Date(),
        },
      ]);
      mockProgressRepo.find.mockResolvedValue([]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([
        {
          id: 'post-1',
          subredditId: 'sub-1',
          title: 'Topic Title',
          selftext: 'Body',
          ups: 100,
        },
      ]);
      mockContentContract.getCommentsByPostIds.mockResolvedValue([
        { id: 'c-1', postId: 'post-1', body: 'Great comment' },
      ]);

      await service.bufferAhead(channelId);

      expect(mockScriptContract.generateScript).toHaveBeenCalled();
      expect(mockVoiceContract.synthesizeScript).toHaveBeenCalled();
    });

    it('handles voice generation failure gracefully without marking posts completed', async () => {
      const channelId = 'chan-1';
      setupChannelSubreddits([
        {
          subredditId: 'sub-1',
          name: 'AskReddit',
          lastScrapedAt: new Date(),
        },
      ]);
      mockProgressRepo.find.mockResolvedValue([]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([
        {
          id: 'post-1',
          subredditId: 'sub-1',
          title: 'Topic Title',
          selftext: 'Body',
          ups: 100,
        },
      ]);
      mockScriptContract.generateScript.mockRejectedValue(
        new Error('LLM error'),
      );

      await service.bufferAhead(channelId);

      expect(mockProgressRepo.save).not.toHaveBeenCalled();
    });
  });
});
