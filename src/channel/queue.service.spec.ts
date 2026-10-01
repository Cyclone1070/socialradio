import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { RequestContext } from '@mikro-orm/core';
import config from '../infrastructure/database/mikro-orm.config';
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

  type BufferClaimCriteria = {
    id?: string;
    bufferClaimId?: string | null;
    $or?: unknown[];
  };

  const mockChannelRepo = {
    findOne: jest.fn(),
    nativeUpdate: jest.fn<
      Promise<number>,
      [BufferClaimCriteria, Record<string, unknown>]
    >(),
  };

  const mockSegmentRepo = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  };

  const mockExecute = jest.fn();
  const mockFork = jest.fn();
  const mockEntityManager = {
    persist: jest.fn().mockReturnThis(),
    flush: jest.fn(),
    fork: mockFork,
    getReference: jest.fn((_cls, id: string) => ({ id }) as unknown as Channel),
    getConnection: jest.fn(() => ({ execute: mockExecute })),
  };
  mockFork.mockReturnValue(mockEntityManager);

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
    // A buffer claim is free unless a test says another instance holds it.
    mockChannelRepo.nativeUpdate.mockResolvedValue(1);
    // clearAllMocks() clears calls, not implementations, so an override from one
    // test used to leak into the next. scrapeSubreddit is fired without being
    // awaited, so it must always return a promise.
    mockContentContract.scrapeSubreddit.mockResolvedValue(undefined);

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
        remove: jest.fn((ref: { id: string }) => {
          const at = completedItems.findIndex((item) => item.id === ref.id);
          if (at >= 0) completedItems.splice(at, 1);
        }),
      },
    });
    mockChannelRepo.findOne.mockResolvedValue(channel);
    mockContentContract.getSubredditsByIds.mockResolvedValue(formatted);
    return channel;
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

      // Consumption goes through the ORM, which owns the pivot table's column
      // names. Raw SQL here is what silently broke when the columns were renamed.
      expect(mockEntityManager.flush).toHaveBeenCalled();
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('releases the consumed post when generation fails, so the retry has a pool', async () => {
      const channelId = 'chan-1';
      const channel = setupChannelSubreddits([
        { subredditId: 'sub-1', name: 'AskReddit', lastScrapedAt: new Date() },
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
        new Error('LLM error on post 1'),
      );

      await service.bufferAhead(channelId);

      // The post is aired nowhere, so it must go back into the pool: retry is
      // demand driven, triggered when the filler that replaced it runs low.
      expect(channel.completedPosts.remove).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'post-1' }),
      );
    });

    it('retires a content-rejected topic and moves to the next one', async () => {
      const channelId = 'chan-1';
      jest.spyOn(service, 'getRandomCount').mockReturnValue(1);
      const channel = setupChannelSubreddits([
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
      mockScriptContract.generateScript
        .mockResolvedValueOnce({
          rejected: true,
          reason: 'missing STEP 4 header',
        })
        .mockResolvedValueOnce('Valid script for post 2');

      await service.bufferAhead(channelId);

      // The model rejected this content, so it is spent: keeping the lease stops
      // the station re-chewing it one wake-up at a time.
      expect(mockScriptContract.generateScript).toHaveBeenCalledTimes(2);
      expect(mockVoiceContract.synthesizeScript).toHaveBeenCalledTimes(1);
      expect(channel.completedPosts.remove).not.toHaveBeenCalled();
      jest.restoreAllMocks();
    });

    it('stops the walk on an infrastructure failure so filler can play', async () => {
      const channelId = 'chan-1';
      jest.spyOn(service, 'getRandomCount').mockReturnValue(1);
      const channel = setupChannelSubreddits([
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
      // Neither the LLM nor TTS can be blamed on the content: every remaining
      // topic would fail the same way, so the cycle gives up and lets the queue
      // append filler instead of grinding through the whole pool.
      mockScriptContract.generateScript.mockRejectedValue(
        new Error('LLM provider stream failed'),
      );

      await service.bufferAhead(channelId);

      expect(mockScriptContract.generateScript).toHaveBeenCalledTimes(1);
      expect(mockVoiceContract.synthesizeScript).not.toHaveBeenCalled();
      expect(channel.completedPosts.remove).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'post-1' }),
      );
      jest.restoreAllMocks();
    });

    it('stops after two rejected topics instead of walking the pool', async () => {
      const channelId = 'chan-1';
      jest.spyOn(service, 'getRandomCount').mockReturnValue(1);
      const channel = setupChannelSubreddits([
        { subredditId: 'sub-1', name: 'AskReddit', lastScrapedAt: new Date() },
      ]);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([
        {
          id: 'post-1',
          subredditId: 'sub-1',
          title: 'Landlord Kept My Deposit',
          selftext: 'Body 1',
          ups: 500,
        },
        {
          id: 'post-2',
          subredditId: 'sub-1',
          title: 'Best Hiking Trails Near Denver',
          selftext: 'Body 2',
          ups: 400,
        },
        {
          id: 'post-3',
          subredditId: 'sub-1',
          title: 'Learning Guitar At 40',
          selftext: 'Body 3',
          ups: 300,
        },
        {
          id: 'post-4',
          subredditId: 'sub-1',
          title: 'Marathon Training In Winter',
          selftext: 'Body 4',
          ups: 200,
        },
        {
          id: 'post-5',
          subredditId: 'sub-1',
          title: 'Cheapest Way To Move Cross Country',
          selftext: 'Body 5',
          ups: 100,
        },
      ]);
      mockScriptContract.generateScript.mockResolvedValue({
        rejected: true,
        reason: 'the model would not write this one',
      });

      await service.bufferAhead(channelId);

      // A provider answering quickly with garbage must not be able to walk the
      // pool: every rejection retires content for good.
      expect(mockScriptContract.generateScript).toHaveBeenCalledTimes(2);
      expect(channel.completedPosts.add).toHaveBeenCalledTimes(2);
      jest.restoreAllMocks();
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

      mockScriptContract.generateScript
        .mockResolvedValueOnce({
          rejected: true,
          reason: 'dialogue rejected: only 3 turns',
        })
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

    it('deduplicates concurrent bufferAhead calls on the same channel to prevent duplicate batch generation', async () => {
      const channelId = 'chan-1';
      // Set explicitly: this test previously inherited these from earlier tests,
      // which is why shuffled order made it fail. The scrape below is fired
      // without being awaited, so it must still return a promise.
      mockSegmentRepo.count.mockResolvedValue(0);
      mockContentContract.scrapeSubreddit.mockResolvedValue(undefined);
      mockContentContract.getCommentsByPostIds.mockResolvedValue([]);
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
      mockScriptContract.generateScript.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve('Script text'), 50),
          ),
      );
      mockVoiceContract.synthesizeScript.mockResolvedValue({
        filePath: 'audio/talk-1.mp3',
        durationSeconds: 60,
        postIds: ['post-1'],
      });

      await Promise.all([
        service.bufferAhead(channelId),
        service.bufferAhead(channelId),
      ]);

      expect(mockScriptContract.generateScript).toHaveBeenCalledTimes(1);
    });
  });

  describe('background request context', () => {
    let orm: MikroORM;

    beforeAll(async () => {
      orm = await MikroORM.init({ ...config, connect: false });
    });

    afterAll(async () => {
      await orm.close(true);
    });

    it('runs outside a request inside its own MikroORM context', async () => {
      const contexts: Array<unknown> = [];
      const backgroundRepo = {
        count: jest.fn(),
        find: jest.fn(),
        // The batch claims the station before it reads anything, so the mock that
        // stands in for the repositories has to answer that claim as well.
        nativeUpdate: jest.fn().mockResolvedValue(1),
        findOne: jest.fn(() => {
          contexts.push(RequestContext.getEntityManager());
          return Promise.reject(new Error('stop-after-first-query'));
        }),
      };

      const backgroundModule = await Test.createTestingModule({
        providers: [
          QueueService,
          {
            provide: getRepositoryToken(ChannelSchema),
            useValue: backgroundRepo,
          },
          {
            provide: getRepositoryToken(SegmentSchema),
            useValue: backgroundRepo,
          },
          { provide: EntityManager, useValue: orm.em },
          { provide: MediaContract, useValue: mockMediaService },
          { provide: ContentContract, useValue: mockContentContract },
          { provide: ScriptContract, useValue: mockScriptContract },
          { provide: VoiceContract, useValue: mockVoiceContract },
        ],
      }).compile();

      const background = backgroundModule.get<QueueService>(QueueService);

      await expect(background.bufferAhead('chan-context')).rejects.toThrow(
        'stop-after-first-query',
      );

      expect(contexts.length).toBeGreaterThan(0);
      expect(contexts[0]).toBeDefined();
    });
  });
  describe('buffering across instances', () => {
    const deferred = <T>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    };
    const takeCall = () => mockChannelRepo.nativeUpdate.mock.calls[0];
    const renewCall = () => mockChannelRepo.nativeUpdate.mock.calls[1];
    const releaseCall = () =>
      mockChannelRepo.nativeUpdate.mock.calls[
        mockChannelRepo.nativeUpdate.mock.calls.length - 1
      ];

    const parkOnPosts = () => {
      const parked = deferred<unknown[]>();
      mockContentContract.getPostsBySubredditIds.mockReturnValueOnce(
        parked.promise,
      );
      return parked;
    };

    const aCluster = [
      { id: 'post-1', subredditId: 'sub-1', title: 'Alpha', score: 10 },
      { id: 'post-2', subredditId: 'sub-1', title: 'Alpha again', score: 9 },
    ];

    it('does not buffer a channel another instance is already buffering', async () => {
      // The atomic take matched no rows: someone else holds a live claim.
      mockChannelRepo.nativeUpdate.mockResolvedValueOnce(0);

      await service.bufferAhead('chan-taken');

      // None of the paid work happened: no posts read, no script, no audio.
      expect(mockContentContract.getPostsBySubredditIds).not.toHaveBeenCalled();
      expect(mockScriptContract.generateScript).not.toHaveBeenCalled();
      expect(mockVoiceContract.synthesizeScript).not.toHaveBeenCalled();
      expect(mockEntityManager.persist).not.toHaveBeenCalled();
    });

    it('claims the channel before buffering and releases it afterwards', async () => {
      mockChannelRepo.findOne.mockResolvedValue(null);

      await service.bufferAhead('chan-free');

      expect(mockChannelRepo.nativeUpdate).toHaveBeenCalledTimes(2);
      const [takeCriteria, takeValues] = takeCall();
      // Free or stale, decided by the database in one write, which is the only
      // thing that makes this safe between processes.
      expect(takeCriteria).toMatchObject({ id: 'chan-free' });
      expect(takeValues).toHaveProperty('bufferClaimId');
      expect(takeValues).toHaveProperty('bufferClaimedAt');

      const [releaseCriteria, releaseValues] = releaseCall();
      // Scoped by our own token: another instance's claim must survive us.
      expect(releaseCriteria).toMatchObject({
        id: 'chan-free',
        bufferClaimId: takeValues.bufferClaimId,
      });
      expect(releaseValues).toMatchObject({
        bufferClaimId: null,
        bufferClaimedAt: null,
      });
    });

    it('may take a claim whose previous owner went quiet', async () => {
      mockChannelRepo.findOne.mockResolvedValue(null);

      await service.bufferAhead('chan-stale');

      const [takeCriteria] = takeCall();
      expect(takeCriteria.$or).toHaveLength(2);
      const stale = takeCriteria.$or?.[1] as {
        bufferClaimedAt: { $lt: Date };
      };
      const ageSeconds =
        (Date.now() - stale.bufferClaimedAt.$lt.getTime()) / 1000;
      // Three missed beats: a crashed instance frees its station.
      expect(ageSeconds).toBeGreaterThanOrEqual(60);
      expect(ageSeconds).toBeLessThanOrEqual(120);
    });

    it('releases the claim even when buffering blows up', async () => {
      mockChannelRepo.findOne.mockRejectedValueOnce(
        new Error('database went away'),
      );

      await expect(service.bufferAhead('chan-boom')).rejects.toThrow(
        'database went away',
      );

      expect(mockChannelRepo.nativeUpdate).toHaveBeenCalledTimes(2);
      const [releaseCriteria] = releaseCall();
      expect(releaseCriteria).toMatchObject({ id: 'chan-boom' });
    });

    it('keeps its claim alive while a slow batch runs', async () => {
      jest.useFakeTimers();
      try {
        const parked = parkOnPosts();
        const running = service.bufferAhead('chan-slow');

        await jest.advanceTimersByTimeAsync(30_000);

        const [renewCriteria, renewValues] = renewCall();
        expect(renewCriteria).toMatchObject({
          id: 'chan-slow',
          bufferClaimId: takeCall()[1].bufferClaimId,
        });
        expect(renewValues).toHaveProperty('bufferClaimedAt');

        parked.resolve([]);
        await running;
      } finally {
        jest.useRealTimers();
      }
    });

    it('stops before the next paid step when its claim is gone', async () => {
      jest.useFakeTimers();
      try {
        setupChannelSubreddits([
          { subredditId: 'sub-1', name: 'news', lastScrapedAt: new Date() },
        ]);
        mockSegmentRepo.count.mockResolvedValueOnce(0);
        mockSegmentRepo.findOne.mockResolvedValueOnce(null);
        const parked = parkOnPosts();
        mockContentContract.getCommentsByPostIds.mockResolvedValue([]);
        // Take wins, the beat then finds another instance holds the station.
        mockChannelRepo.nativeUpdate
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(0);

        const running = service.bufferAhead('chan-lost');
        await jest.advanceTimersByTimeAsync(30_000);
        parked.resolve(aCluster);
        await running;

        // The script is the first thing that costs money, so it is never asked for.
        expect(mockScriptContract.generateScript).not.toHaveBeenCalled();
        expect(mockVoiceContract.synthesizeScript).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
