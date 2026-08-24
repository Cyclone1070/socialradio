import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { EntityManager } from '@mikro-orm/postgresql';
import { QueueService } from './queue.service';
import { Channel } from './entities/channel.entity';
import {
  ChannelSchema,
  SegmentSchema,
} from '../infrastructure/database/schemas/channel.schema';
import {
  ContentContract,
  ScriptContract,
  VoiceContract,
  MediaContract,
} from '../domain/contracts';

describe('QueueService', () => {
  let service: QueueService;

  const mockChannelRepo = {
    findOne: jest.fn(),
  };

  const mockSegmentRepo = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  };

  const mockEntityManager = {
    persist: jest.fn().mockReturnThis(),
    flush: jest.fn(),
    getReference: jest.fn((_cls, id: string) => ({ id }) as unknown as Channel),
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
          provide: getRepositoryToken(ChannelSchema),
          useValue: mockChannelRepo,
        },
        {
          provide: getRepositoryToken(SegmentSchema),
          useValue: mockSegmentRepo,
        },
        { provide: EntityManager, useValue: mockEntityManager },
        { provide: MediaContract, useValue: mockMediaService },
        { provide: ContentContract, useValue: mockContentContract },
        { provide: ScriptContract, useValue: mockScriptContract },
        { provide: VoiceContract, useValue: mockVoiceContract },
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
    jest.clearAllMocks();
    mockEntityManager.persist.mockReturnThis();

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
      filePath: 'audio/talk-123.mp3',
      durationSeconds: 60,
      postIds: ['post-1'],
    });
    jest.spyOn(service, 'getRandomCount').mockReturnValue(1);
  });

  function setupChannelSubreddits(
    subs: Array<{
      id?: string;
      subredditId?: string;
      name: string;
      lastScrapedAt: Date | null;
    }>,
    completedPosts: Array<{ id: string }> = [],
  ) {
    const formatted = subs.map((s, idx) => ({
      id: s.id || s.subredditId || `sub-${idx + 1}`,
      name: s.name,
      lastScrapedAt: s.lastScrapedAt,
      createdAt: new Date(),
    }));
    const completedItems = [...completedPosts];
    const channel = Object.assign(new Channel(), {
      id: 'chan-1',
      subreddits: {
        getItems: jest.fn().mockReturnValue(formatted),
      },
      completedPosts: {
        getItems: jest.fn().mockReturnValue(completedItems),
        add: jest.fn((ref: { id: string }) => {
          completedItems.push(ref);
        }),
      },
    });
    mockChannelRepo.findOne.mockResolvedValue(channel);
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
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([]);
      mockContentContract.scrapeSubreddit.mockResolvedValue(undefined);

      await service.bufferAhead(channelId);

      expect(mockContentContract.scrapeSubreddit).toHaveBeenCalledWith(
        'AskReddit',
      );
    });

    it('should NOT trigger scraping at 4 days since the last scrape if subreddit still has unplayed posts', async () => {
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
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([
        {
          id: 'post-1',
          subredditId: 'sub-1',
          title: 'Breaking Space Discovery',
        },
        {
          id: 'post-2',
          subredditId: 'sub-1',
          title: 'Local Bakery Wins Award',
        },
      ]);

      await service.bufferAhead(channelId);

      expect(mockContentContract.scrapeSubreddit).not.toHaveBeenCalled();
    });

    it('should NOT trigger scraping if channel already has 20 active subreddits with unplayed posts even if some are stale', async () => {
      const channelId = 'chan-1';
      mockSegmentRepo.count.mockResolvedValue(0);

      // 22 subreddits, all 22 have unplayed posts, but half are older than 7 days (stale)
      const staleDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const freshDate = new Date();
      const subs = Array.from({ length: 22 }, (_, i) => ({
        subredditId: `sub-${i + 1}`,
        name: `sub${i + 1}`,
        lastScrapedAt: i % 2 === 0 ? staleDate : freshDate,
      }));
      setupChannelSubreddits(subs);

      // 2 posts per subreddit with distinct topics to prevent cross-sub clustering
      const posts: Array<{ id: string; subredditId: string; title: string }> =
        [];
      subs.forEach((s, i) => {
        posts.push({
          id: `post-${i + 1}-a`,
          subredditId: s.subredditId,
          title: `Alpha Topic ${i + 1}`,
        });
        posts.push({
          id: `post-${i + 1}-b`,
          subredditId: s.subredditId,
          title: `Beta Topic ${i + 1}`,
        });
      });
      mockContentContract.getPostsBySubredditIds.mockResolvedValue(posts);

      await service.bufferAhead(channelId);

      expect(mockContentContract.scrapeSubreddit).not.toHaveBeenCalled();
    });

    it('should scrape only toScrapeCount inactive subreddits prioritizing never scraped and oldest lastScrapedAt', async () => {
      const channelId = 'chan-1';
      mockSegmentRepo.count.mockResolvedValue(0);

      // 17 active subs with posts
      const activeSubs = Array.from({ length: 17 }, (_, i) => ({
        subredditId: `active-${i + 1}`,
        name: `active${i + 1}`,
        lastScrapedAt: new Date(),
      }));

      // 5 inactive subs with different dates
      const inactiveSubs = [
        {
          subredditId: 'in-recent',
          name: 'in_recent',
          lastScrapedAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
        },
        {
          subredditId: 'in-never-1',
          name: 'in_never_1',
          lastScrapedAt: null, // Priority 1
        },
        {
          subredditId: 'in-oldest',
          name: 'in_oldest',
          lastScrapedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago (Priority 3)
        },
        {
          subredditId: 'in-never-2',
          name: 'in_never_2',
          lastScrapedAt: null, // Priority 2
        },
        {
          subredditId: 'in-medium',
          name: 'in_medium',
          lastScrapedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        },
      ];

      setupChannelSubreddits([...activeSubs, ...inactiveSubs]);

      // 2 posts per active sub with distinct topics so all 17 remain active after 1 is played
      const posts: Array<{ id: string; subredditId: string; title: string }> =
        [];
      activeSubs.forEach((s, i) => {
        posts.push({
          id: `post-${i + 1}-a`,
          subredditId: s.subredditId,
          title: `Gamma Topic ${i + 1}`,
        });
        posts.push({
          id: `post-${i + 1}-b`,
          subredditId: s.subredditId,
          title: `Delta Topic ${i + 1}`,
        });
      });
      mockContentContract.getPostsBySubredditIds.mockResolvedValue(posts);

      // toScrapeCount = min(20, 22) - 17 = 3
      await service.bufferAhead(channelId);

      expect(mockContentContract.scrapeSubreddit).toHaveBeenCalledTimes(3);
      expect(mockContentContract.scrapeSubreddit).toHaveBeenCalledWith(
        'in_never_1',
      );
      expect(mockContentContract.scrapeSubreddit).toHaveBeenCalledWith(
        'in_never_2',
      );
      expect(mockContentContract.scrapeSubreddit).toHaveBeenCalledWith(
        'in_oldest',
      );
      expect(mockContentContract.scrapeSubreddit).not.toHaveBeenCalledWith(
        'in_recent',
      );
      expect(mockContentContract.scrapeSubreddit).not.toHaveBeenCalledWith(
        'in_medium',
      );
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
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([]);

      await service.bufferAhead(channelId);

      expect(mockContentContract.scrapeSubreddit).toHaveBeenCalledWith('news');
    });

    it('should trigger scraping if channel has 0 unplayed posts (exhausted)', async () => {
      const channelId = 'chan-1';
      mockSegmentRepo.count.mockResolvedValue(0);
      setupChannelSubreddits(
        [
          {
            subredditId: 'sub-1',
            name: 'funny',
            lastScrapedAt: new Date(),
          },
        ],
        [{ id: 'post-1' }, { id: 'post-2' }],
      );
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
    it('appends talk segment when topic is found, saves voice track, and marks posts completed immediately', async () => {
      const channelId = 'chan-1';
      setupChannelSubreddits([
        {
          subredditId: 'sub-1',
          name: 'AskReddit',
          lastScrapedAt: new Date(),
        },
      ]);
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

    it('retries next available topic when first topic fails voice generation', async () => {
      const channelId = 'chan-1';
      setupChannelSubreddits([
        {
          subredditId: 'sub-1',
          name: 'AskReddit',
          lastScrapedAt: new Date(),
        },
      ]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([
        {
          id: 'post-1',
          subredditId: 'sub-1',
          title: 'Topic Title 1',
          selftext: 'Body 1',
          ups: 200,
        },
        {
          id: 'post-2',
          subredditId: 'sub-1',
          title: 'Cooking Pasta Recipe',
          selftext: 'Body 2',
          ups: 100,
        },
      ]);

      // First LLM call fails, second succeeds
      mockScriptContract.generateScript
        .mockRejectedValueOnce(new Error('LLM error on post 1'))
        .mockResolvedValueOnce('Valid script for post 2');

      await service.bufferAhead(channelId);

      expect(mockScriptContract.generateScript).toHaveBeenCalledTimes(2);
      expect(mockVoiceContract.synthesizeScript).toHaveBeenCalledTimes(1);
    });

    it('falls back to filler when all available topics fail generation', async () => {
      const channelId = 'chan-1';
      setupChannelSubreddits([
        {
          subredditId: 'sub-1',
          name: 'AskReddit',
          lastScrapedAt: new Date(),
        },
      ]);
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
        new Error('LLM permanent failure'),
      );

      await service.bufferAhead(channelId);

      expect(mockScriptContract.generateScript).toHaveBeenCalledTimes(1);
      expect(mockMediaService.getRandomAd).toHaveBeenCalled();
    });
  });
});
