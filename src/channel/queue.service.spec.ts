import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { LockMode, RequestContext } from '@mikro-orm/core';
import { PinoLogger } from 'nestjs-pino';
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
    // A transaction runs its callback inline, handing over this same mock as the
    // transaction's entity manager - which is what the service must work through.
    transactional: jest.fn(<T>(cb: (em: unknown) => Promise<T>): Promise<T> =>
      cb(mockEntityManager),
    ),
    getRepository: jest.fn((cls: unknown) =>
      cls === ChannelSchema ? mockChannelRepo : mockSegmentRepo,
    ),
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
    getRandomJingle: jest.fn(),
    getRandomLiner: jest.fn(),
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
    mockMediaService.getRandomLiner.mockResolvedValue({
      filePath: 'liners/back-01.mp3',
      durationSeconds: 4,
      text: 'We will be right back.',
    });
    mockContentContract.getCommentsByPostIds.mockResolvedValue([]);
    // Nothing queued ahead unless a test says otherwise: the runway read asks.
    mockSegmentRepo.find.mockResolvedValue([]);
    mockScriptContract.generateScript.mockResolvedValue('Mock script text');
    mockVoiceContract.synthesizeScript.mockResolvedValue({
      filePath: 'audio/talk-123.mp3',
      durationSeconds: 60,
      postIds: ['post-1'],
    });
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
    // The station row holds whatever token the run took: the real claim is a
    // conditional write, so the fixture reads it back instead of guessing it.
    Object.defineProperty(channel, 'bufferClaimId', {
      configurable: true,
      get: () =>
        (
          mockChannelRepo.nativeUpdate.mock.calls[0]?.[1] as
            { bufferClaimId?: string } | undefined
        )?.bufferClaimId ?? null,
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

      // Asked directly: this is the pool policy, and the run only asks it once the
      // station has aired everything it had.
      await service.checkAndScrapePoolDeficit(channelId, new Set());
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockContentContract.scrapeSubreddit).not.toHaveBeenCalled();
    });

    it('should NOT ask for a scrape while enough subreddits still hold unplayed posts', async () => {
      const channelId = 'chan-1';
      // 22 subreddits, all 22 have unplayed posts, half are older than 7 days (stale)
      const staleDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const freshDate = new Date();
      const subs = Array.from({ length: 22 }, (_, i) => ({
        subredditId: `sub-${i + 1}`,
        name: `sub${i + 1}`,
        lastScrapedAt: i % 2 === 0 ? staleDate : freshDate,
      }));
      setupChannelSubreddits(subs);

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

      // Asked directly: the run only asks this question once the station has aired
      // everything it had, which is exactly when asking is right.
      await service.checkAndScrapePoolDeficit(channelId, new Set());
      // The scrape chain is deliberately not awaited by the caller; let it land
      // before the assertions so it cannot leak into the next test either.
      await new Promise((resolve) => setTimeout(resolve, 0));

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

      // toScrapeCount = min(20, 22) - 17 = 3. Asked directly, because the run only
      // asks once the station has aired everything it had.
      await service.checkAndScrapePoolDeficit(channelId, new Set());
      await new Promise((resolve) => setTimeout(resolve, 0));

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

  describe('the run', () => {
    function runwayOf(
      segments: Array<{ playOrder: number; durationSeconds: number }>,
    ) {
      mockSegmentRepo.findOne.mockResolvedValue(null);
      mockSegmentRepo.find.mockResolvedValue(segments);
    }

    function postsOf(...titles: string[]) {
      mockContentContract.getPostsBySubredditIds.mockResolvedValue(
        titles.map((title, idx) => ({
          id: `post-${idx + 1}`,
          subredditId: `sub-${idx + 1}`,
          title,
          selftext: `Body ${idx + 1}`,
          ups: 100 - idx,
        })),
      );
    }

    function subsOf(count: number) {
      setupChannelSubreddits(
        Array.from({ length: count }, (_, idx) => ({
          subredditId: `sub-${idx + 1}`,
          name: `sub${idx + 1}`,
          lastScrapedAt: new Date(),
        })),
      );
    }

    function conversationsOf(seconds: number) {
      mockVoiceContract.synthesizeScript.mockResolvedValue({
        filePath: 'audio/talk.mp3',
        durationSeconds: seconds,
        postIds: ['post-1'],
      });
    }

    function appended(): Array<{ type: string; playOrder: number }> {
      return mockEntityManager.persist.mock.calls.map(
        (call: unknown[]) => call[0] as { type: string; playOrder: number },
      );
    }

    it('writes nothing when the queue already has a healthy runway', async () => {
      runwayOf([{ playOrder: 1, durationSeconds: 1200 }]);
      subsOf(1);

      await service.bufferAhead('chan-1');

      expect(mockScriptContract.generateScript).not.toHaveBeenCalled();
      expect(mockEntityManager.persist).not.toHaveBeenCalled();
    });

    it('produces talk until it has at least thirty minutes, then closes with a liner and one song', async () => {
      runwayOf([]);
      subsOf(2);
      postsOf('Topic Alpha', 'Topic Beta');
      conversationsOf(900);

      await service.bufferAhead('chan-1');

      expect(appended().map((item) => item.type)).toEqual([
        'talk',
        'talk',
        'liner',
        'music',
      ]);
      expect(appended().map((item) => item.playOrder)).toEqual([1, 2, 3, 4]);
    });

    it('closes the block after a single conversation longer than the target', async () => {
      runwayOf([]);
      subsOf(1);
      postsOf('Topic Alpha');
      conversationsOf(2000);

      await service.bufferAhead('chan-1');

      expect(appended().map((item) => item.type)).toEqual([
        'talk',
        'liner',
        'music',
      ]);
    });

    it('appends nothing when there is no topic, and asks reddit for more', async () => {
      runwayOf([]);
      subsOf(1);
      mockContentContract.getPostsBySubredditIds.mockResolvedValue([]);

      await service.bufferAhead('chan-1');

      expect(mockContentContract.scrapeSubreddit).toHaveBeenCalled();
      expect(mockEntityManager.persist).not.toHaveBeenCalled();
    });

    it('gives a failing pipeline exactly one more go, then keeps what it has', async () => {
      runwayOf([]);
      subsOf(3);
      postsOf('Topic Alpha', 'Topic Beta', 'Topic Gamma');
      conversationsOf(400);
      mockScriptContract.generateScript
        .mockRejectedValueOnce(new Error('provider blip'))
        .mockResolvedValueOnce('A script')
        .mockRejectedValueOnce(new Error('provider blip again'))
        .mockRejectedValueOnce(new Error('and again'));

      await service.bufferAhead('chan-1');

      expect(appended().map((item) => item.type)).toEqual([
        'talk',
        'liner',
        'music',
      ]);
    });

    it('does not mark a topic it has only picked', async () => {
      runwayOf([]);
      const channel = setupChannelSubreddits([
        { subredditId: 'sub-1', name: 'sub1', lastScrapedAt: new Date() },
      ]);
      postsOf('Topic Alpha');
      mockScriptContract.generateScript.mockRejectedValue(
        new Error('provider is down'),
      );

      await service.bufferAhead('chan-1');

      expect(channel.completedPosts.add).not.toHaveBeenCalled();
      expect(channel.completedPosts.remove).not.toHaveBeenCalled();
    });

    it('retires a topic the model rejected, so the next run does not pick it again', async () => {
      runwayOf([]);
      const channel = setupChannelSubreddits([
        { subredditId: 'sub-1', name: 'sub1', lastScrapedAt: new Date() },
      ]);
      postsOf('Topic Alpha');
      mockScriptContract.generateScript.mockResolvedValue({
        rejected: true,
        reason: 'missing STEP 4 header',
        postId: 'post-1',
        turns: [],
      });

      await service.bufferAhead('chan-1');

      expect(channel.completedPosts.add).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'post-1' }),
      );
      expect(mockEntityManager.persist).not.toHaveBeenCalled();
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
        // Nothing queued ahead unless a test says otherwise: the runway read asks.
        mockSegmentRepo.find.mockResolvedValue([]);
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

  describe('claiming work atomically', () => {});

  describe('the watchdog', () => {
    function drainedRunway() {
      mockSegmentRepo.find.mockResolvedValue([]);
    }

    function tailIs(type: string) {
      mockSegmentRepo.findOne.mockImplementation(
        (where: { playOrder?: unknown }) =>
          where?.playOrder
            ? Promise.resolve(null)
            : Promise.resolve({ playOrder: 4, type, durationSeconds: 200 }),
      );
    }

    function written(): string[] {
      return mockEntityManager.persist.mock.calls.map(
        (call: unknown[]) => (call[0] as { type: string }).type,
      );
    }

    it('announces and plays two songs when a conversation is about to run out', async () => {
      setupChannelSubreddits([
        { subredditId: 'sub-1', name: 'sub1', lastScrapedAt: new Date() },
      ]);
      drainedRunway();
      tailIs('talk');

      await service.ensureFiller('chan-1');

      expect(written()).toEqual(['liner', 'music', 'music']);
    });

    it('stays silent when a break has just played', async () => {
      setupChannelSubreddits([
        { subredditId: 'sub-1', name: 'sub1', lastScrapedAt: new Date() },
      ]);
      drainedRunway();
      tailIs('music');

      await service.ensureFiller('chan-1');

      expect(written()).toEqual(['music', 'music']);
    });

    it('leaves the station alone when the runway is no longer short', async () => {
      setupChannelSubreddits([
        { subredditId: 'sub-1', name: 'sub1', lastScrapedAt: new Date() },
      ]);
      mockSegmentRepo.find.mockResolvedValue([{ durationSeconds: 600 }]);
      tailIs('talk');

      await service.ensureFiller('chan-1');

      expect(mockEntityManager.persist).not.toHaveBeenCalled();
    });

    it('warns with how short the station was', async () => {
      setupChannelSubreddits([
        { subredditId: 'sub-1', name: 'sub1', lastScrapedAt: new Date() },
      ]);
      drainedRunway();
      tailIs('talk');
      const warnSpy = jest
        .spyOn(PinoLogger.prototype, 'warn')
        .mockImplementation(() => {});

      await service.ensureFiller('chan-1');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ channelId: 'chan-1', runwaySeconds: 0 }),
        expect.stringContaining('run out'),
      );
      warnSpy.mockRestore();
    });
  });

  describe('appendBlock', () => {
    function station(token: string | null) {
      return {
        id: 'chan-1',
        bufferClaimId: token,
        completedPosts: {
          getItems: () => [],
          add: jest.fn(),
          remove: jest.fn(),
        },
      };
    }

    it('writes every segment of the block in one transaction, ordered after the tail', async () => {
      mockChannelRepo.findOne.mockResolvedValue(station('tok-1'));
      mockSegmentRepo.findOne.mockResolvedValue({ playOrder: 4 });

      const written = await service.appendBlock('chan-1', 'tok-1', [
        {
          kind: 'talk',
          clusterId: 'cluster-1',
          audioUrl: 'audio/talk-1.mp3',
          durationSeconds: 300,
        },
        { kind: 'liner', audioUrl: 'liners/back-01.mp3', durationSeconds: 4 },
        {
          kind: 'music',
          title: 'Song',
          artist: 'Artist',
          audioUrl: 'music/song.mp3',
          durationSeconds: 180,
        },
      ]);

      expect(written).toBe(3);
      expect(mockEntityManager.transactional).toHaveBeenCalledTimes(1);
      expect(mockChannelRepo.findOne).toHaveBeenCalledWith(
        { id: 'chan-1' },
        expect.objectContaining({ lockMode: LockMode.PESSIMISTIC_WRITE }),
      );
      const persisted = mockEntityManager.persist.mock.calls.map(
        (call: unknown[]) => call[0] as { playOrder: number; type: string },
      );
      expect(persisted.map((item) => item.playOrder)).toEqual([5, 6, 7]);
      expect(persisted.map((item) => item.type)).toEqual([
        'talk',
        'liner',
        'music',
      ]);
      expect(mockEntityManager.flush).toHaveBeenCalled();
    });

    it('discards the block when the claim changed hands while it was generated', async () => {
      mockChannelRepo.findOne.mockResolvedValue(
        station('tok-from-another-run'),
      );

      const written = await service.appendBlock('chan-1', 'tok-1', [
        {
          kind: 'music',
          title: 'Song',
          artist: 'Artist',
          audioUrl: 'music/song.mp3',
          durationSeconds: 180,
        },
      ]);

      expect(written).toBe(0);
      expect(mockEntityManager.persist).not.toHaveBeenCalled();
    });

    it('writes without a claim, because the watchdog holds none', async () => {
      mockChannelRepo.findOne.mockResolvedValue(station('tok-from-a-run'));
      mockSegmentRepo.findOne.mockResolvedValue(null);

      const written = await service.appendBlock('chan-1', null, [
        {
          kind: 'music',
          title: 'Song',
          artist: 'Artist',
          audioUrl: 'music/song.mp3',
          durationSeconds: 180,
        },
      ]);

      expect(written).toBe(1);
      expect(mockEntityManager.persist).toHaveBeenCalledTimes(1);
    });

    it('marks the posts of the conversations it writes, skipping ones already used', async () => {
      const used = {
        id: 'chan-1',
        bufferClaimId: 'tok-1',
        completedPosts: {
          getItems: () => [{ id: 'post-0' }],
          add: jest.fn(),
          remove: jest.fn(),
        },
      };
      mockChannelRepo.findOne.mockResolvedValue(used);
      mockSegmentRepo.findOne.mockResolvedValue({ playOrder: 2 });

      await service.appendBlock('chan-1', 'tok-1', [
        {
          kind: 'talk',
          clusterId: 'cluster-1',
          postIds: ['post-0', 'post-1', 'post-2'],
          audioUrl: 'audio/talk-1.mp3',
          durationSeconds: 300,
        },
        {
          kind: 'liner',
          audioUrl: 'liners/back-01.mp3',
          durationSeconds: 4,
        },
      ]);

      const marked = used.completedPosts.add.mock.calls.map(
        (call: unknown[]) => (call[0] as { id: string }).id,
      );
      expect(marked).toEqual(['post-1', 'post-2']);
    });

    it('writes nothing at all for an empty block', async () => {
      const written = await service.appendBlock('chan-1', 'tok-1', []);

      expect(written).toBe(0);
      expect(mockEntityManager.transactional).not.toHaveBeenCalled();
      expect(mockEntityManager.persist).not.toHaveBeenCalled();
    });
  });
});
