import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { SegmentService } from './segment.service';
import {
  Segment,
  TalkSegment,
  SongSegment,
  AdSegment,
  JingleSegment,
} from './entities/segment.entity';
import {
  ContentContract,
  ChannelContract,
  ScriptContract,
  VoiceContract,
} from '../domain/contracts';
import { PostData } from '../domain';
import { MediaService } from '../media/media.service';

describe('SegmentService', () => {
  let service: SegmentService;

  const mockSegmentRepo = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
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

  const mockChannelContract = {
    getSubredditIdsForChannel: jest.fn(),
    getCompletedPostIdsForChannel: jest.fn(),
    markPostCompletedForChannel: jest.fn(),
    sliceAndUploadChunk: jest.fn().mockResolvedValue(undefined),
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
        SegmentService,
        {
          provide: getRepositoryToken(Segment),
          useValue: mockSegmentRepo,
        },
        { provide: MediaService, useValue: mockMediaService },
        { provide: ContentContract, useValue: mockContentContract },
        { provide: ChannelContract, useValue: mockChannelContract },
        { provide: ScriptContract, useValue: mockScriptContract },
        { provide: VoiceContract, useValue: mockVoiceContract },
      ],
    }).compile();

    service = module.get<SegmentService>(SegmentService);
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
    mockChannelContract.getSubredditIdsForChannel.mockResolvedValue(
      formatted.map((s) => s.id),
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
      mockChannelContract.getCompletedPostIdsForChannel.mockResolvedValue([]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([]);
      mockContentContract.scrapeSubreddit.mockResolvedValue(undefined);

      await service.bufferAhead(channelId);

      expect(mockContentContract.scrapeSubreddit).toHaveBeenCalledWith(
        'AskReddit',
      );
    });

    it('should NOT trigger scraping at 4 days since the last scrape (7-day window)', async () => {
      const channelId = 'chan-1';
      // 96h ago is stale under the old 72h window but NOT under 7 days —
      // this discriminates the two windows (73h sat on the old knife-edge).
      const nearlyFresh = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
      mockSegmentRepo.count.mockResolvedValue(0);
      setupChannelSubreddits([
        {
          subredditId: 'sub-1',
          name: 'news',
          lastScrapedAt: nearlyFresh,
        },
      ]);
      // An unplayed post exists, so the exhausted arm cannot mask the
      // stale check: only the window decides.
      mockChannelContract.getCompletedPostIdsForChannel.mockResolvedValue([]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([
        { id: 'post-1', subredditId: 'sub-1', title: 'news title' },
      ]);

      await service.bufferAhead(channelId);

      expect(mockContentContract.scrapeSubreddit).not.toHaveBeenCalled();
    });

    it('should trigger scraping if lastScrapedAt is older than 7 days', async () => {
      const channelId = 'chan-1';
      const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days ago
      mockSegmentRepo.count.mockResolvedValue(0);
      setupChannelSubreddits([
        {
          subredditId: 'sub-1',
          name: 'news',
          lastScrapedAt: staleDate,
        },
      ]);
      mockChannelContract.getCompletedPostIdsForChannel.mockResolvedValue([]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([]);

      await service.bufferAhead(channelId);

      expect(mockContentContract.scrapeSubreddit).toHaveBeenCalledWith('news');
    });

    it('should trigger scraping if channel has 0 unplayed posts (exhausted)', async () => {
      const channelId = 'chan-1';
      const freshDate = new Date(Date.now() - 5 * 60 * 60 * 1000); // 5 hours ago (fresh)
      mockSegmentRepo.count.mockResolvedValue(0);
      setupChannelSubreddits([
        {
          subredditId: 'sub-1',
          name: 'pics',
          lastScrapedAt: freshDate,
        },
      ]);
      // We have post-1, but channel already completed post-1 (exhausted!)
      mockChannelContract.getCompletedPostIdsForChannel.mockResolvedValue([
        'post-1',
      ]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([
        { id: 'post-1', subredditId: 'sub-1', title: 'pics title' },
      ]);

      await service.bufferAhead(channelId);

      expect(mockContentContract.scrapeSubreddit).toHaveBeenCalledWith('pics');
    });

    it('should NOT trigger scraping if cache is fresh and there are unplayed posts', async () => {
      const channelId = 'chan-1';
      const freshDate = new Date(Date.now() - 5 * 60 * 60 * 1000); // 5 hours ago
      mockSegmentRepo.count.mockResolvedValue(0);
      setupChannelSubreddits([
        {
          subredditId: 'sub-1',
          name: 'funny',
          lastScrapedAt: freshDate,
        },
      ]);
      // post-1 exists, and progress has no record of post-1 (unplayed exists)
      mockChannelContract.getCompletedPostIdsForChannel.mockResolvedValue([]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([
        { id: 'post-1', subredditId: 'sub-1', title: 'funny post title' },
      ]);

      await service.bufferAhead(channelId);

      expect(mockContentContract.scrapeSubreddit).not.toHaveBeenCalled();
    });

    it('should fire background scrapes WITHOUT blocking topic generation', async () => {
      const channelId = 'chan-1';
      mockSegmentRepo.findOne.mockResolvedValue(null); // no last item
      setupChannelSubreddits([
        {
          subredditId: 'sub-1',
          name: 'AskReddit',
          lastScrapedAt: null,
        },
      ]);
      mockChannelContract.getCompletedPostIdsForChannel.mockResolvedValue([]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([
        { id: 'post-1', subredditId: 'sub-1', title: 'Post 1' },
      ]);

      // Scrape stays pending — bufferAhead must NOT await it
      let resolveScrape!: () => void;
      mockContentContract.scrapeSubreddit.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveScrape = resolve;
        }),
      );

      await expect(service.bufferAhead(channelId)).resolves.toBeUndefined();

      // Clean up the dangling background scrape
      resolveScrape();
      expect(mockContentContract.scrapeSubreddit).toHaveBeenCalledWith(
        'AskReddit',
      );
    });

    it('should scrape multiple subs SEQUENTIALLY — the next fires only after the previous completes', async () => {
      const channelId = 'chan-1';
      mockSegmentRepo.findOne.mockResolvedValue(null); // no last item
      setupChannelSubreddits([
        {
          id: 'sub-1',
          name: 'alpha',
          lastScrapedAt: null,
        },
        {
          id: 'sub-2',
          name: 'beta',
          lastScrapedAt: null,
        },
      ]);
      mockChannelContract.getCompletedPostIdsForChannel.mockResolvedValue([]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([]);

      // One talk slot → exactly one sequential chain (no double-fire)
      jest.spyOn(service, 'getRandomCount').mockReturnValue(1);

      const fired: string[] = [];
      const resolvers: Array<() => void> = [];
      mockContentContract.scrapeSubreddit.mockImplementation((name: string) => {
        fired.push(name);
        return new Promise<void>((resolve) => resolvers.push(resolve));
      });

      await service.bufferAhead(channelId);

      // Only the FIRST sub fires immediately; the second must wait
      expect(fired).toEqual(['alpha']);

      // Completing the first lets the second fire
      resolvers[0]();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fired).toEqual(['alpha', 'beta']);

      resolvers[1]();
    });
  });

  describe('bufferAhead', () => {
    it('should generate media items and queue a talk item if queue is low', async () => {
      const channelId = 'chan-1';

      // Mock queue has 0 future items, so it needs to generate more
      mockSegmentRepo.count.mockResolvedValue(0);
      mockSegmentRepo.findOne.mockResolvedValue(null);

      // Mock subscription to subreddit 'sub-1'
      setupChannelSubreddits([
        { subredditId: 'sub-1', name: 'SpaceX', lastScrapedAt: new Date() },
      ]);

      // Mock 0 completed post progress
      mockChannelContract.getCompletedPostIdsForChannel.mockResolvedValue([]);

      // Mock 2 available posts (1 SpaceX, 1 SpaceX repost) in that subreddit
      const post1: PostData = {
        id: 'post-1',
        redditId: 'r1',
        title: 'SpaceX Falcon Heavy launch',
        body: '',
        score: 100,
        subredditId: 'sub-1',
      };
      const post2: PostData = {
        id: 'post-2',
        redditId: 'r2',
        title: 'SpaceX Falcon Heavy launch delayed',
        body: '',
        score: 80,
        subredditId: 'sub-1',
      };
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([
        post1,
        post2,
      ]);

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

      expect(mockMediaService.getRandomJingle).toHaveBeenCalled();
      expect(mockMediaService.getRandomMusic).toHaveBeenCalled();
      expect(mockMediaService.getRandomAd).toHaveBeenCalled();

      // Check that ScriptGeneratorContract is called with clustered posts
      expect(mockScriptContract.generateScript).toHaveBeenCalled();

      // Check progress mark is called for BOTH posts to prevent replaying
      expect(
        mockChannelContract.markPostCompletedForChannel,
      ).toHaveBeenCalledWith(channelId, 'post-1');

      // Check queued items order and instance type (STI verification):
      expect(mockSavedItems[0] instanceof TalkSegment).toBe(true);

      // Talk item's topicId should store the primary post ID ('post-1')
      expect((mockSavedItems[0] as TalkSegment).topicId).toBe('topic-post-1');
    });

    it('should append a full cycle even when the queue already holds 5+ segments (no size gate)', async () => {
      const channelId = 'chan-1';
      // Old total-row gate returned early at 5 rows — permanently stalling
      // refills (dead air). Callers own the "when"; bufferAhead just appends.
      mockSegmentRepo.count.mockResolvedValue(5);
      mockSegmentRepo.findOne.mockResolvedValue(null); // no last item
      mockChannelContract.getSubredditIdsForChannel.mockResolvedValue([]);
      mockContentContract.getSubredditsByIds.mockResolvedValue([]); // no subscriptions → no topic
      mockChannelContract.getCompletedPostIdsForChannel.mockResolvedValue([]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([]);

      // Force getRandomCount to return 1
      jest.spyOn(service, 'getRandomCount').mockReturnValue(1);

      const mockSavedItems: Segment[] = [];
      mockSegmentRepo.save.mockImplementation((item) => {
        mockSavedItems.push(item as Segment);
        return Promise.resolve(item as Segment);
      });

      await service.bufferAhead(channelId);

      // Full cycle: talk-slot filler + song + ad + jingle
      expect(mockSavedItems.length).toBe(4);
      expect(mockSegmentRepo.save).toHaveBeenCalledTimes(4);
    });

    it('should append an ad filler when no topic is available', async () => {
      const channelId = 'chan-1';
      const freshDate = new Date(Date.now() - 5 * 60 * 60 * 1000); // 5 hours ago
      mockSegmentRepo.findOne.mockResolvedValue(null); // no last item
      setupChannelSubreddits([
        {
          subredditId: 'sub-1',
          name: 'funny',
          lastScrapedAt: freshDate,
        },
      ]);
      mockChannelContract.getCompletedPostIdsForChannel.mockResolvedValue([]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([]); // 0 unplayed posts → no topic

      // Force getRandomCount to return 1
      jest.spyOn(service, 'getRandomCount').mockReturnValue(1);

      const mockSavedItems: Segment[] = [];
      mockSegmentRepo.save.mockImplementation((item) => {
        mockSavedItems.push(item as Segment);
        return Promise.resolve(item as Segment);
      });

      await service.bufferAhead(channelId);

      // Talk slot is filled by a short ad filler (fast topic re-check),
      // then the pattern continues: song + ad + jingle
      expect(mockSavedItems[0]).toBeInstanceOf(AdSegment);
      expect(mockSavedItems.length).toBe(4);
    });

    it('should generate segments following the pattern: [1-2 Talk] -> [1-2 Songs] -> [1-2 Ads] -> [1 Jingle] (Branch: 1 each)', async () => {
      const channelId = 'chan-1';
      mockSegmentRepo.count.mockResolvedValue(0);
      mockSegmentRepo.findOne.mockResolvedValue(null);
      setupChannelSubreddits([
        { subredditId: 'sub-1', name: 'AskReddit', lastScrapedAt: new Date() },
      ]);
      mockChannelContract.getCompletedPostIdsForChannel.mockResolvedValue([]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([
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
      setupChannelSubreddits([
        { subredditId: 'sub-1', name: 'AskReddit', lastScrapedAt: new Date() },
      ]);
      mockChannelContract.getCompletedPostIdsForChannel.mockResolvedValue([]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([
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

  it('logs an error with the segmentId when voice generation fails', async () => {
    const channelId = 'chan-1';
    mockSegmentRepo.count.mockResolvedValue(0);
    setupChannelSubreddits([
      {
        subredditId: 'sub-1',
        name: 'news',
        lastScrapedAt: null,
      },
    ]);
    mockChannelContract.getCompletedPostIdsForChannel.mockResolvedValue([]);
    mockContentContract.getPostsBySubredditIds.mockResolvedValue([
      { id: 'post-1', subredditId: 'sub-1', title: 'news title' },
    ]);
    mockContentContract.scrapeSubreddit.mockResolvedValue(undefined);
    mockVoiceContract.synthesizeScript.mockRejectedValue(
      new Error('TTS quota exceeded'),
    );

    const savedItems: Array<Record<string, unknown>> = [];
    mockSegmentRepo.create.mockImplementation((dto): Segment => dto);
    mockSegmentRepo.save.mockImplementation((item): Promise<Segment> =>
      Promise.resolve({
        ...(item as Record<string, unknown>),
        id: 'seg-' + (savedItems.length + 1),
      } as unknown as Segment),
    );

    const errorSpy = jest
      .spyOn(PinoLogger.prototype, 'error')
      .mockImplementation(() => {});

    await service.bufferAhead(channelId);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId,
        segmentId: expect.any(String) as string,
        err: expect.any(Error) as Error,
      }),
      expect.stringContaining('voice'),
    );
  });

  describe('scraping-chain logs', () => {
    it('logs the background chain with channelId + sub list when scrapes are fired', async () => {
      const channelId = 'chan-1';
      mockSegmentRepo.count.mockResolvedValue(0);
      setupChannelSubreddits([
        {
          subredditId: 'sub-1',
          name: 'news',
          lastScrapedAt: null,
        },
      ]);
      mockChannelContract.getCompletedPostIdsForChannel.mockResolvedValue([]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([]);
      mockContentContract.scrapeSubreddit.mockResolvedValue(undefined);

      const infoSpy = jest
        .spyOn(PinoLogger.prototype, 'info')
        .mockImplementation(() => {});

      await service.findPendingTopicSegment(channelId);

      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId,
          subsToScrape: ['news'],
        }),
        expect.stringContaining('chain'),
      );
    });

    it('logs the per-sub decision (stale vs exhausted vs fresh) at debug', async () => {
      const channelId = 'chan-1';
      mockSegmentRepo.count.mockResolvedValue(0);
      // sub-1 stale, sub-2 fresh-but-exhausted, sub-3 fresh with unplayed
      setupChannelSubreddits([
        {
          id: 'sub-1',
          name: 'news',
          lastScrapedAt: null,
        },
        {
          id: 'sub-2',
          name: 'pics',
          lastScrapedAt: new Date(),
        },
        {
          id: 'sub-3',
          name: 'music',
          lastScrapedAt: new Date(),
        },
      ]);
      mockChannelContract.getCompletedPostIdsForChannel.mockResolvedValue([
        'post-2',
      ]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([
        { id: 'post-2', subredditId: 'sub-2', title: 'pics title' },
        { id: 'post-3', subredditId: 'sub-3', title: 'music title' },
      ]);
      mockContentContract.scrapeSubreddit.mockResolvedValue(undefined);

      const debugSpy = jest
        .spyOn(PinoLogger.prototype, 'debug')
        .mockImplementation(() => {});

      await service.findPendingTopicSegment(channelId);

      expect(debugSpy).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'news', decision: 'stale' }),
        expect.any(String),
      );
      expect(debugSpy).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'pics', decision: 'exhausted' }),
        expect.any(String),
      );
      expect(debugSpy).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'music', decision: 'fresh' }),
        expect.any(String),
      );
    });
  });
});
