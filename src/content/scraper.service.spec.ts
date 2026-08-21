import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import { PinoLogger } from 'nestjs-pino';
import { ScraperService, SCRAPE_WINDOW_MS } from './scraper.service';
import { RedditScraperService } from './reddit-scraper.service';
import { Subreddit } from './entities/subreddit.entity';
import { Post } from './entities/post.entity';
import {
  SubredditSchema,
  PostSchema,
  CommentSchema,
} from '../infrastructure/database/schemas/content.schema';

describe('ScraperService', () => {
  let service: ScraperService;

  const mockSubredditRepo = {
    findOne: jest.fn(),
    nativeDelete: jest.fn(),
  };

  const mockPostRepo = {
    findOne: jest.fn(),
    nativeDelete: jest.fn(),
  };

  const mockCommentRepo = {};

  const mockEntityManager = {
    persist: jest.fn().mockReturnThis(),
    flush: jest.fn(),
  };

  const mockRedditScraper = {
    fetchTopPosts: jest.fn(),
    fetchPostComments: jest.fn(),
    exists: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScraperService,
        {
          provide: getRepositoryToken(SubredditSchema),
          useValue: mockSubredditRepo,
        },
        { provide: getRepositoryToken(PostSchema), useValue: mockPostRepo },
        {
          provide: getRepositoryToken(CommentSchema),
          useValue: mockCommentRepo,
        },
        { provide: EntityManager, useValue: mockEntityManager },
        { provide: RedditScraperService, useValue: mockRedditScraper },
      ],
    }).compile();

    service = module.get<ScraperService>(ScraperService);
    jest.clearAllMocks();
    mockEntityManager.persist.mockReturnThis();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('scrapeSubreddit', () => {
    it("stops the walk when a page repeats the previous page's first post id (guard)", async () => {
      const subName = 'AskReddit';
      const subEntity = Object.assign(new Subreddit(), {
        id: 'sub-uuid',
        name: subName,
        lastScrapedAt: null,
      });

      const cleanupSpy = jest
        .spyOn(service, 'cleanupOldData')
        .mockResolvedValue(undefined);

      mockSubredditRepo.findOne.mockResolvedValue(subEntity);

      const makePage = (firstId: string, after: string | null) => ({
        posts: [firstId, `${firstId}b`, `${firstId}c`].map((id, i) => ({
          id,
          title: `T ${i}`,
          selftext: '',
          author: 'op',
          score: 10,
          created_utc: 1719999999,
        })),
        after,
        isInvalid: false,
      });
      mockRedditScraper.fetchTopPosts
        .mockResolvedValueOnce(makePage('loop1', 't3_1'))
        .mockResolvedValueOnce(makePage('loop1', 't3_2'));
      mockPostRepo.findOne.mockResolvedValue(null);
      mockRedditScraper.fetchPostComments.mockResolvedValue([
        {
          id: 'c',
          body: 'hello '.repeat(2600).trim(),
          author: 'user',
          score: 10,
          parent_id: 't3_p',
          created_utc: 1719999999,
        },
      ]);

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 6 });
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenCalledTimes(2);
      expect(cleanupSpy).toHaveBeenCalled();
    });

    it('stops on pool exhaustion: after: null on page 1 → no second call', async () => {
      const subName = 'AskReddit';
      const subEntity = Object.assign(new Subreddit(), {
        id: 'sub-uuid',
        name: subName,
        lastScrapedAt: null,
      });

      const cleanupSpy = jest
        .spyOn(service, 'cleanupOldData')
        .mockResolvedValue(undefined);

      mockSubredditRepo.findOne.mockResolvedValue(subEntity);

      const rawPosts = Array.from({ length: 3 }, (_, i) => ({
        id: `p${i + 1}`,
        title: `T ${i + 1}`,
        selftext: '',
        author: 'op',
        score: 10,
        created_utc: 1719999999,
      }));
      mockRedditScraper.fetchTopPosts.mockResolvedValue({
        posts: rawPosts,
        after: null,
        isInvalid: false,
      });
      mockPostRepo.findOne.mockResolvedValue(null);
      mockRedditScraper.fetchPostComments.mockResolvedValue([
        {
          id: 'c',
          body: 'hello '.repeat(2600).trim(),
          author: 'user',
          score: 10,
          parent_id: 't3_p',
          created_utc: 1719999999,
        },
      ]);

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 3 });
      expect(cleanupSpy).toHaveBeenCalled();
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenCalledTimes(1);
    });

    it('keeps walking when page 1 is all duplicates: dedup never stops the walk', async () => {
      const subName = 'AskReddit';
      const subEntity = Object.assign(new Subreddit(), {
        id: 'sub-uuid',
        name: subName,
        lastScrapedAt: null,
      });

      const cleanupSpy = jest
        .spyOn(service, 'cleanupOldData')
        .mockResolvedValue(undefined);

      mockSubredditRepo.findOne.mockResolvedValue(subEntity);

      const dupPage = Array.from({ length: 3 }, (_, i) => ({
        id: `dup${i + 1}`,
        title: `Dup ${i + 1}`,
        selftext: '',
        author: 'op',
        score: 10,
        created_utc: 1719999999,
      }));
      const freshPage = [
        {
          id: 'fresh',
          title: 'Fresh',
          selftext: '',
          author: 'op',
          score: 10,
          created_utc: 1719999999,
        },
      ];
      mockRedditScraper.fetchTopPosts
        .mockResolvedValueOnce({
          posts: dupPage,
          after: 't3_x',
          isInvalid: false,
        })
        .mockResolvedValueOnce({
          posts: freshPage,
          after: null,
          isInvalid: false,
        });
      mockPostRepo.findOne.mockImplementation((q: { redditId: string }) =>
        q.redditId === 'fresh' ? null : { id: 'existing' },
      );
      mockRedditScraper.fetchPostComments.mockResolvedValue([
        {
          id: 'c',
          body: 'hello '.repeat(2600).trim(),
          author: 'user',
          score: 10,
          parent_id: 't3_p',
          created_utc: 1719999999,
        },
      ]);

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 1 });
      expect(cleanupSpy).toHaveBeenCalled();
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenCalledTimes(2);
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenNthCalledWith(
        2,
        subName,
        {
          limit: 100,
          after: 't3_x',
        },
      );
      expect(mockRedditScraper.fetchPostComments).toHaveBeenCalledTimes(1);
      expect(mockRedditScraper.fetchPostComments).toHaveBeenCalledWith(
        subName,
        'fresh',
      );
    });

    it('stops the walk when a page fails mid-walk: partials kept, sub not deleted', async () => {
      const subName = 'AskReddit';
      const subEntity = Object.assign(new Subreddit(), {
        id: 'sub-uuid',
        name: subName,
        lastScrapedAt: null,
      });

      const cleanupSpy = jest
        .spyOn(service, 'cleanupOldData')
        .mockResolvedValue(undefined);

      mockSubredditRepo.findOne.mockResolvedValue(subEntity);

      const page1 = Array.from({ length: 5 }, (_, i) => ({
        id: `p${i + 1}`,
        title: `T ${i + 1}`,
        selftext: '',
        author: 'op',
        score: 10,
        created_utc: 1719999999,
      }));
      mockRedditScraper.fetchTopPosts
        .mockResolvedValueOnce({
          posts: page1,
          after: 't3_x',
          isInvalid: false,
        })
        .mockRejectedValueOnce(
          new Error('reddit-fetcher /top-posts/AskReddit failed: 502'),
        );
      mockPostRepo.findOne.mockResolvedValue(null);
      mockRedditScraper.fetchPostComments.mockResolvedValue([
        {
          id: 'c',
          body: 'hello '.repeat(2600).trim(),
          author: 'user',
          score: 10,
          parent_id: 't3_p',
          created_utc: 1719999999,
        },
      ]);

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 5 });
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenCalledTimes(2);
      expect(mockSubredditRepo.nativeDelete).not.toHaveBeenCalled();
      expect(cleanupSpy).toHaveBeenCalled();
      expect(subEntity.lastScrapedAt).toBeInstanceOf(Date);
    });

    it('stops quietly when the very first page fails: 0 saved, sub kept, no throw', async () => {
      const subName = 'downSub';
      const subEntity = Object.assign(new Subreddit(), {
        id: 'down-uuid',
        name: subName,
        lastScrapedAt: null,
      });

      mockSubredditRepo.findOne.mockResolvedValue(subEntity);
      mockRedditScraper.fetchTopPosts.mockRejectedValue(
        new Error('reddit-fetcher /top-posts/downSub failed: 502'),
      );

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 0 });
      expect(mockSubredditRepo.nativeDelete).not.toHaveBeenCalled();
    });

    it('walks to the next page while under 20: page 2 is fetched with after=t3_x, exactly 2 calls', async () => {
      const subName = 'AskReddit';
      const subEntity = Object.assign(new Subreddit(), {
        id: 'sub-uuid',
        name: subName,
        lastScrapedAt: null,
      });

      const cleanupSpy = jest
        .spyOn(service, 'cleanupOldData')
        .mockResolvedValue(undefined);

      mockSubredditRepo.findOne.mockResolvedValue(subEntity);

      const page1 = Array.from({ length: 5 }, (_, i) => ({
        id: `p${i + 1}`,
        title: `T ${i + 1}`,
        selftext: '',
        author: 'op',
        score: 10,
        created_utc: 1719999999,
      }));
      const page2 = Array.from({ length: 20 }, (_, i) => ({
        id: `q${i + 1}`,
        title: `Q ${i + 1}`,
        selftext: '',
        author: 'op',
        score: 10,
        created_utc: 1719999999,
      }));
      mockRedditScraper.fetchTopPosts
        .mockResolvedValueOnce({
          posts: page1,
          after: 't3_x',
          isInvalid: false,
        })
        .mockResolvedValueOnce({
          posts: page2,
          after: null,
          isInvalid: false,
        });
      mockPostRepo.findOne.mockResolvedValue(null);
      mockRedditScraper.fetchPostComments.mockResolvedValue([
        {
          id: 'c',
          body: 'hello '.repeat(2600).trim(),
          author: 'user',
          score: 10,
          parent_id: 't3_p',
          created_utc: 1719999999,
        },
      ]);

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 20 });
      expect(cleanupSpy).toHaveBeenCalled();
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenCalledTimes(2);
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenNthCalledWith(
        1,
        subName,
        { limit: 100 },
      );
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenNthCalledWith(
        2,
        subName,
        { limit: 100, after: 't3_x' },
      );
    });

    it('stops mid-page at the 20th save: 20 comment fetches, one page, post 21 untouched', async () => {
      const subName = 'AskReddit';
      const subEntity = Object.assign(new Subreddit(), {
        id: 'sub-uuid',
        name: subName,
        lastScrapedAt: null,
      });

      const cleanupSpy = jest
        .spyOn(service, 'cleanupOldData')
        .mockResolvedValue(undefined);

      mockSubredditRepo.findOne.mockResolvedValue(subEntity);

      const rawPosts = Array.from({ length: 25 }, (_, i) => ({
        id: `post${i + 1}`,
        title: `Title ${i + 1}`,
        selftext: `Body ${i + 1}`,
        author: `op${i + 1}`,
        score: 100 + i,
        created_utc: 1719999999,
      }));
      mockRedditScraper.fetchTopPosts.mockResolvedValue({
        posts: rawPosts,
        after: 't3_x',
        isInvalid: false,
      });
      mockPostRepo.findOne.mockResolvedValue(null);
      mockRedditScraper.fetchPostComments.mockResolvedValue([
        {
          id: 'c',
          body: 'hello '.repeat(2600).trim(),
          author: 'user',
          score: 10,
          parent_id: 't3_p',
          created_utc: 1719999999,
        },
      ]);

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 20 });
      expect(cleanupSpy).toHaveBeenCalled();
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenCalledTimes(1);
      expect(mockRedditScraper.fetchPostComments).toHaveBeenCalledTimes(20);
      expect(mockRedditScraper.fetchPostComments).not.toHaveBeenCalledWith(
        subName,
        'post21',
      );
      const savedPosts = (
        mockEntityManager.persist.mock.calls as Array<[unknown]>
      )
        .map((c) => c[0])
        .filter((entity): entity is Post => entity instanceof Post);
      expect(savedPosts).toHaveLength(20);
      expect(savedPosts[19].redditId).toBe('post20');
    });

    it('should scrape new posts and comments, filtering out posts with under 2500 words and capping at 20 saved posts', async () => {
      const subName = 'AskReddit';
      const subEntity = Object.assign(new Subreddit(), {
        id: 'sub-uuid',
        name: subName,
        lastScrapedAt: null,
      });

      const cleanupSpy = jest
        .spyOn(service, 'cleanupOldData')
        .mockResolvedValue(undefined);

      mockSubredditRepo.findOne.mockResolvedValue(subEntity);

      const rawPosts = [
        {
          id: 'post1',
          title: 'Title 1',
          selftext: 'Body 1',
          author: 'op1',
          score: 100,
          created_utc: 1719999999,
        },
        {
          id: 'post2',
          title: 'Title 2',
          selftext: 'Body 2',
          author: 'op2',
          score: 200,
          created_utc: 1719999999,
        },
        {
          id: 'post3',
          title: 'Title 3',
          selftext: 'Body 3',
          author: 'op3',
          score: 300,
          created_utc: 1719999999,
        },
      ];
      mockRedditScraper.fetchTopPosts.mockResolvedValue({
        posts: rawPosts,
        isInvalid: false,
      });
      mockPostRepo.findOne.mockResolvedValue(null);

      const post1Comments = [
        {
          id: 'c1',
          body: 'hello '.repeat(2200).trim(),
          author: 'user1',
          score: 10,
          parent_id: 't3_post1',
          created_utc: 1719999999,
        },
      ];
      const post2Comments = [
        {
          id: 'c2',
          body: 'hello '.repeat(1500).trim(),
          author: 'user2',
          score: 10,
          parent_id: 't3_post2',
          created_utc: 1719999999,
        },
      ];
      const post3Comments = [
        {
          id: 'c3',
          body: 'hello '.repeat(2700).trim(),
          author: 'user3',
          score: 10,
          parent_id: 't3_post3',
          created_utc: 1719999999,
        },
      ];

      mockRedditScraper.fetchPostComments.mockImplementation((_sub, postId) => {
        if (postId === 'post1') return Promise.resolve(post1Comments);
        if (postId === 'post2') return Promise.resolve(post2Comments);
        if (postId === 'post3') return Promise.resolve(post3Comments);
        return Promise.resolve([]);
      });

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 1 });
      expect(cleanupSpy).toHaveBeenCalled();
      expect(mockRedditScraper.exists).not.toHaveBeenCalled();
      expect(mockSubredditRepo.findOne).toHaveBeenCalledWith({
        name: subName,
      });

      expect(mockRedditScraper.fetchTopPosts).toHaveBeenCalledWith(subName, {
        limit: 100,
      });

      expect(mockRedditScraper.fetchPostComments).toHaveBeenCalledWith(
        subName,
        'post1',
      );
      expect(mockRedditScraper.fetchPostComments).toHaveBeenCalledWith(
        subName,
        'post2',
      );
      expect(mockRedditScraper.fetchPostComments).toHaveBeenCalledWith(
        subName,
        'post3',
      );

      const savedPosts = (
        mockEntityManager.persist.mock.calls as Array<[unknown]>
      )
        .map((call) => call[0])
        .filter((entity): entity is Post => entity instanceof Post);
      const savedPostIds = savedPosts.map((p) => p.redditId);
      expect(savedPostIds).toContain('post3');
      expect(savedPostIds).not.toContain('post1');
      expect(savedPostIds).not.toContain('post2');
    });

    it('should delete subreddit completely when fetchTopPosts reports isInvalid', async () => {
      const subName = 'bannedSub';
      const subEntity = Object.assign(new Subreddit(), {
        id: 'banned-uuid',
        name: subName,
        lastScrapedAt: null,
      });

      mockSubredditRepo.findOne.mockResolvedValue(subEntity);
      mockRedditScraper.fetchTopPosts.mockResolvedValue({
        posts: [],
        isInvalid: true,
      });

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 0 });
      expect(mockSubredditRepo.nativeDelete).toHaveBeenCalledWith({
        id: 'banned-uuid',
      });
      expect(mockRedditScraper.exists).not.toHaveBeenCalled();
    });

    it('should dedupe a scrape already in-flight via scrapeStartedAt', async () => {
      const subName = 'askreddit';
      const subreddit = Object.assign(new Subreddit(), {
        id: 'sub-1',
        name: subName,
        lastScrapedAt: new Date(Date.now() - 1000),
        scrapeStartedAt: new Date(Date.now() - 10000),
      });
      mockSubredditRepo.findOne.mockResolvedValue(subreddit);

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 0 });
      expect(mockRedditScraper.exists).not.toHaveBeenCalled();
    });

    it('should set a 2h cooldown when a scrape yields 0 new posts', async () => {
      const subName = 'askreddit';
      const subreddit = Object.assign(new Subreddit(), {
        id: 'sub-1',
        name: subName,
        lastScrapedAt: null,
      });
      mockSubredditRepo.findOne.mockResolvedValue(subreddit);
      mockRedditScraper.fetchTopPosts.mockResolvedValue({
        posts: [],
        isInvalid: false,
      });

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 0 });
      expect(subreddit.scrapeCooldownUntil).toBeInstanceOf(Date);
      expect(subreddit.scrapeCooldownUntil!.getTime()).toBeGreaterThan(
        Date.now() + 2 * 60 * 60 * 1000 - 1000,
      );
    });

    it('should bypass claim and cooldown when force is true', async () => {
      const subName = 'askreddit';
      const subreddit = Object.assign(new Subreddit(), {
        id: 'sub-1',
        name: subName,
        lastScrapedAt: null,
        scrapeStartedAt: new Date(Date.now() - 10000),
        scrapeCooldownUntil: new Date(Date.now() + 60 * 60 * 1000),
      });
      mockSubredditRepo.findOne.mockResolvedValue(subreddit);
      mockRedditScraper.fetchTopPosts.mockResolvedValue({
        posts: [],
        isInvalid: false,
      });

      const result = await service.scrapeSubreddit(subName, true);

      expect(mockRedditScraper.exists).not.toHaveBeenCalled();
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenCalled();
      expect(result).toEqual({ scrapedPostsCount: 0 });
    });

    it('should save new posts BEFORE purging old ones (per-sub scope)', async () => {
      const subName = 'askreddit';
      const subEntity = Object.assign(new Subreddit(), {
        id: 'sub-1',
        name: subName,
        lastScrapedAt: null,
      });
      mockSubredditRepo.findOne.mockResolvedValue(subEntity);

      const rawPosts = [
        {
          id: 'p1',
          title: 'T',
          selftext: '',
          author: 'op',
          score: 10,
          created_utc: 1719999999,
        },
      ];
      mockRedditScraper.fetchTopPosts.mockResolvedValue({
        posts: rawPosts,
        isInvalid: false,
      });
      mockRedditScraper.fetchPostComments.mockResolvedValue([
        {
          id: 'c1',
          body: 'hello '.repeat(2600).trim(),
          author: 'user',
          score: 10,
          parent_id: 't3_p1',
          created_utc: 1719999999,
        },
      ]);
      mockPostRepo.findOne.mockResolvedValue(null);

      const cleanupSpy = jest.spyOn(service, 'cleanupOldData');

      const result = await service.scrapeSubreddit(subName);

      expect(result.scrapedPostsCount).toBe(1);
      expect(mockEntityManager.persist).toHaveBeenCalled();
      expect(cleanupSpy).toHaveBeenCalledWith('sub-1');
    });

    it('stops quietly when the page fetch fails on the first call', async () => {
      const subName = 'downSub';
      const subEntity = Object.assign(new Subreddit(), {
        id: 'down-uuid',
        name: subName,
        lastScrapedAt: null,
      });

      mockSubredditRepo.findOne.mockResolvedValue(subEntity);
      mockRedditScraper.fetchTopPosts.mockRejectedValue(
        new Error('Browser connection lost'),
      );

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 0 });
      expect(mockSubredditRepo.nativeDelete).not.toHaveBeenCalled();
    });
  });

  describe('cleanupOldData', () => {
    it('should delete posts older than the 7-day window (SCRAPE_WINDOW_MS)', async () => {
      mockPostRepo.nativeDelete.mockResolvedValue(5);

      await service.cleanupOldData();

      expect(mockPostRepo.nativeDelete).toHaveBeenCalled();
      const deleteCalls = mockPostRepo.nativeDelete.mock.calls as Array<
        [FilterQuery<Post>]
      >;
      const deleteArg = deleteCalls[0][0] as { scrapedAt: { $lt: Date } };
      expect(deleteArg.scrapedAt.$lt).toBeInstanceOf(Date);
      const passedDate = deleteArg.scrapedAt.$lt;
      const expectedCutoff = Date.now() - SCRAPE_WINDOW_MS;

      expect(passedDate.getTime()).toBeCloseTo(expectedCutoff, -3);
    });
  });

  describe('validateSubreddit', () => {
    it('should return true if RedditScraperService.exists returns true', async () => {
      mockRedditScraper.fetchTopPosts.mockResolvedValue([]);
      mockRedditScraper.exists.mockResolvedValue(true);

      const result = await service.validateSubreddit('AskReddit');

      expect(result).toBe(true);
      expect(mockRedditScraper.exists).toHaveBeenCalledWith('AskReddit');
    });

    it('should return false if RedditScraperService.exists returns false', async () => {
      mockRedditScraper.exists.mockResolvedValue(false);

      const result = await service.validateSubreddit('private');

      expect(result).toBe(false);
      expect(mockRedditScraper.exists).toHaveBeenCalledWith('private');
    });
  });

  describe('scraping logs', () => {
    const subName = 'askreddit';
    const subEntity = Object.assign(new Subreddit(), {
      id: 'sub-uuid',
      name: subName,
      lastScrapedAt: null,
    });

    function mockFullPostSave() {
      mockSubredditRepo.findOne.mockResolvedValue(subEntity);
      jest.spyOn(service, 'cleanupOldData').mockResolvedValue(undefined);
      mockPostRepo.findOne.mockResolvedValue(null);
      mockRedditScraper.fetchPostComments.mockResolvedValue([
        {
          id: 'c',
          body: 'hello '.repeat(2600).trim(),
          author: 'user',
          score: 10,
          parent_id: 't3_p',
          created_utc: 1719999999,
        },
      ]);
    }

    function pageOf(
      count: number,
      prefix: string,
    ): Array<{
      id: string;
      title: string;
      selftext: string;
      author: string;
      score: number;
      created_utc: number;
    }> {
      return Array.from({ length: count }, (_, i) => ({
        id: `${prefix}${i + 1}`,
        title: `T ${i + 1}`,
        selftext: '',
        author: 'op',
        score: 10,
        created_utc: 1719999999,
      }));
    }

    it('logs ONE summary line with stopReason when the walk finishes', async () => {
      mockFullPostSave();
      const infoSpy = jest
        .spyOn(PinoLogger.prototype, 'info')
        .mockImplementation(() => {});
      mockRedditScraper.fetchTopPosts.mockResolvedValue({
        posts: pageOf(25, 'p'),
        after: null,
        isInvalid: false,
      });

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 20 });
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: subName,
          saved: 20,
          pages: 1,
          stopReason: 'saved-20',
          scrapeId: expect.any(String) as string,
        }),
        'scrape walk finished',
      );
    });

    it('warns with the reason when a scrape is blocked (cooldown)', async () => {
      const cooling = Object.assign(new Subreddit(), {
        id: 'sub-1',
        name: subName,
        lastScrapedAt: new Date(),
        scrapeStartedAt: null,
        scrapeCooldownUntil: new Date(Date.now() + 60_000),
      });
      mockSubredditRepo.findOne.mockResolvedValue(cooling);
      const warnSpy = jest
        .spyOn(PinoLogger.prototype, 'warn')
        .mockImplementation(() => {});

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 0 });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ sub: subName, reason: 'cooldown' }),
        expect.stringContaining('skipped'),
      );
    });

    it('logs an error with stopReason when a page fetch fails mid-walk', async () => {
      mockFullPostSave();
      const errorSpy = jest
        .spyOn(PinoLogger.prototype, 'error')
        .mockImplementation(() => {});
      mockRedditScraper.fetchTopPosts
        .mockResolvedValueOnce({
          posts: pageOf(5, 'p'),
          after: 't3_x',
          isInvalid: false,
        })
        .mockRejectedValueOnce(new Error('502 from fetcher'));

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 5 });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: subName,
          stopReason: 'fetch-fail',
          err: expect.any(Error) as Error,
        }),
        expect.stringContaining('page fetch'),
      );
    });
  });
});
