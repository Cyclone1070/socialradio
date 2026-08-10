import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ScraperService, SCRAPE_WINDOW_MS } from './scraper.service';
import { RedditScraperService } from './reddit-scraper.service';
import { Subreddit } from '../domain/entities/subreddit.entity';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';

describe('ScraperService', () => {
  let service: ScraperService;

  const mockSubredditRepo = {
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };

  const mockPostRepo = {
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };

  const mockCommentRepo = {
    create: jest.fn(),
    save: jest.fn(),
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
        { provide: getRepositoryToken(Subreddit), useValue: mockSubredditRepo },
        { provide: getRepositoryToken(Post), useValue: mockPostRepo },
        { provide: getRepositoryToken(Comment), useValue: mockCommentRepo },
        { provide: RedditScraperService, useValue: mockRedditScraper },
      ],
    }).compile();

    service = module.get<ScraperService>(ScraperService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('scrapeSubreddit', () => {
    it("stops the walk when a page repeats the previous page's first post id (guard)", async () => {
      const subName = 'AskReddit';
      const subEntity = { id: 'sub-uuid', name: subName, lastScrapedAt: null };

      const cleanupSpy = jest
        .spyOn(service, 'cleanupOldData')
        .mockResolvedValue(undefined);

      mockSubredditRepo.findOneBy.mockResolvedValue(subEntity);
      mockSubredditRepo.save.mockResolvedValue(subEntity);

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
      // Pathological repeat: page 2 opens with the same first post as page 1.
      mockRedditScraper.fetchTopPosts
        .mockResolvedValueOnce(makePage('loop1', 't3_1'))
        .mockResolvedValueOnce(makePage('loop1', 't3_2'));
      mockPostRepo.findOneBy.mockResolvedValue(null); // all posts are new
      mockRedditScraper.fetchPostComments.mockResolvedValue([
        {
          id: 'c',
          body: 'hello '.repeat(2600).trim(), // passes the 2500-word guard
          author: 'user',
          score: 10,
          parent_id: 't3_p',
          created_utc: 1719999999,
        },
      ]);
      mockCommentRepo.create.mockImplementation((c): Partial<Comment> => ({
        id: 'c-uuid',
        ...c,
      }));
      mockCommentRepo.save.mockImplementation((c): Promise<Partial<Comment>> =>
        Promise.resolve(c),
      );
      mockPostRepo.create.mockImplementation((p): Partial<Post> => ({
        id: 'p-uuid',
        ...p,
      }));
      mockPostRepo.save.mockImplementation((p): Promise<Partial<Post>> =>
        Promise.resolve(p),
      );

      const result = await service.scrapeSubreddit(subName);

      // Both pages were processed, but the repeated first post id halts the
      // walk before any third page.
      expect(result).toEqual({ scrapedPostsCount: 6 });
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenCalledTimes(2);
      expect(cleanupSpy).toHaveBeenCalled();
    });

    it('stops on pool exhaustion: after: null on page 1 → no second call', async () => {
      const subName = 'AskReddit';
      const subEntity = { id: 'sub-uuid', name: subName, lastScrapedAt: null };

      const cleanupSpy = jest
        .spyOn(service, 'cleanupOldData')
        .mockResolvedValue(undefined);

      mockSubredditRepo.findOneBy.mockResolvedValue(subEntity);
      mockSubredditRepo.save.mockResolvedValue(subEntity);

      const rawPosts = Array.from({ length: 3 }, (_, i) => ({
        id: `p${i + 1}`,
        title: `T ${i + 1}`,
        selftext: '',
        author: 'op',
        score: 10,
        created_utc: 1719999999,
      }));
      // The fetcher collapses a zero-viable page the same way: after: null
      // is the stop signal whether the pool ended or nothing was viable.
      mockRedditScraper.fetchTopPosts.mockResolvedValue({
        posts: rawPosts,
        after: null,
        isInvalid: false,
      });
      mockPostRepo.findOneBy.mockResolvedValue(null); // all posts are new
      mockRedditScraper.fetchPostComments.mockResolvedValue([
        {
          id: 'c',
          body: 'hello '.repeat(2600).trim(), // passes the 2500-word guard
          author: 'user',
          score: 10,
          parent_id: 't3_p',
          created_utc: 1719999999,
        },
      ]);
      mockCommentRepo.create.mockImplementation((c): Partial<Comment> => ({
        id: 'c-uuid',
        ...c,
      }));
      mockCommentRepo.save.mockImplementation((c): Promise<Partial<Comment>> =>
        Promise.resolve(c),
      );
      mockPostRepo.create.mockImplementation((p): Partial<Post> => ({
        id: 'p-uuid',
        ...p,
      }));
      mockPostRepo.save.mockImplementation((p): Promise<Partial<Post>> =>
        Promise.resolve(p),
      );

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 3 });
      expect(cleanupSpy).toHaveBeenCalled();
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenCalledTimes(1);
    });

    it('keeps walking when page 1 is all duplicates: dedup never stops the walk', async () => {
      const subName = 'AskReddit';
      const subEntity = { id: 'sub-uuid', name: subName, lastScrapedAt: null };

      const cleanupSpy = jest
        .spyOn(service, 'cleanupOldData')
        .mockResolvedValue(undefined);

      mockSubredditRepo.findOneBy.mockResolvedValue(subEntity);
      mockSubredditRepo.save.mockResolvedValue(subEntity);

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
      // Every post on page 1 already exists in the DB; the page-2 post is new.
      mockPostRepo.findOneBy.mockImplementation((q: { redditId: string }) =>
        q.redditId === 'fresh' ? null : { id: 'existing' },
      );
      mockRedditScraper.fetchPostComments.mockResolvedValue([
        {
          id: 'c',
          body: 'hello '.repeat(2600).trim(), // passes the 2500-word guard
          author: 'user',
          score: 10,
          parent_id: 't3_p',
          created_utc: 1719999999,
        },
      ]);
      mockCommentRepo.create.mockImplementation((c): Partial<Comment> => ({
        id: 'c-uuid',
        ...c,
      }));
      mockCommentRepo.save.mockImplementation((c): Promise<Partial<Comment>> =>
        Promise.resolve(c),
      );
      mockPostRepo.create.mockImplementation((p): Partial<Post> => ({
        id: 'p-uuid',
        ...p,
      }));
      mockPostRepo.save.mockImplementation((p): Promise<Partial<Post>> =>
        Promise.resolve(p),
      );

      const result = await service.scrapeSubreddit(subName);

      // The all-duplicate page did NOT stop the walk: page 2 was fetched
      // with the cursor and its fresh post was saved.
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
      // Duplicates never reach the comment fetcher.
      expect(mockRedditScraper.fetchPostComments).toHaveBeenCalledTimes(1);
      expect(mockRedditScraper.fetchPostComments).toHaveBeenCalledWith(
        subName,
        'fresh',
      );
    });

    it('stops the walk when a page fails mid-walk: partials kept, sub not deleted', async () => {
      const subName = 'AskReddit';
      const subEntity = { id: 'sub-uuid', name: subName, lastScrapedAt: null };

      const cleanupSpy = jest
        .spyOn(service, 'cleanupOldData')
        .mockResolvedValue(undefined);

      mockSubredditRepo.findOneBy.mockResolvedValue(subEntity);
      mockSubredditRepo.save.mockResolvedValue(subEntity);

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
      mockPostRepo.findOneBy.mockResolvedValue(null);
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
      mockCommentRepo.create.mockImplementation((c): Partial<Comment> => ({
        id: 'c-uuid',
        ...c,
      }));
      mockCommentRepo.save.mockImplementation((c): Promise<Partial<Comment>> =>
        Promise.resolve(c),
      );
      mockPostRepo.create.mockImplementation((p): Partial<Post> => ({
        id: 'p-uuid',
        ...p,
      }));
      mockPostRepo.save.mockImplementation((p): Promise<Partial<Post>> =>
        Promise.resolve(p),
      );

      const result = await service.scrapeSubreddit(subName);

      // Page 1's 5 posts are kept; the failed page 2 stops the walk; the
      // subreddit row survives (a !ok page is not a dead sub).
      expect(result).toEqual({ scrapedPostsCount: 5 });
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenCalledTimes(2);
      expect(mockSubredditRepo.delete).not.toHaveBeenCalled();
      expect(cleanupSpy).toHaveBeenCalled();
      expect(subEntity.lastScrapedAt).toBeInstanceOf(Date);
    });

    it('stops quietly when the very first page fails: 0 saved, sub kept, no throw', async () => {
      const subName = 'downSub';
      const subEntity = { id: 'down-uuid', name: subName, lastScrapedAt: null };

      mockSubredditRepo.findOneBy.mockResolvedValue(subEntity);
      mockSubredditRepo.save.mockResolvedValue(subEntity);
      mockRedditScraper.fetchTopPosts.mockRejectedValue(
        new Error('reddit-fetcher /top-posts/downSub failed: 502'),
      );

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 0 });
      expect(mockSubredditRepo.delete).not.toHaveBeenCalled();
    });

    it('walks to the next page while under 20: page 2 is fetched with after=t3_x, exactly 2 calls', async () => {
      const subName = 'AskReddit';
      const subEntity = { id: 'sub-uuid', name: subName, lastScrapedAt: null };

      const cleanupSpy = jest
        .spyOn(service, 'cleanupOldData')
        .mockResolvedValue(undefined);

      mockSubredditRepo.findOneBy.mockResolvedValue(subEntity);
      mockSubredditRepo.save.mockResolvedValue(subEntity);

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
      mockPostRepo.findOneBy.mockResolvedValue(null); // all posts are new
      mockRedditScraper.fetchPostComments.mockResolvedValue([
        {
          id: 'c',
          body: 'hello '.repeat(2600).trim(), // passes the 2500-word guard
          author: 'user',
          score: 10,
          parent_id: 't3_p',
          created_utc: 1719999999,
        },
      ]);
      mockCommentRepo.create.mockImplementation((c): Partial<Comment> => ({
        id: 'c-uuid',
        ...c,
      }));
      mockCommentRepo.save.mockImplementation((c): Promise<Partial<Comment>> =>
        Promise.resolve(c),
      );
      mockPostRepo.create.mockImplementation((p): Partial<Post> => ({
        id: 'p-uuid',
        ...p,
      }));
      mockPostRepo.save.mockImplementation((p): Promise<Partial<Post>> =>
        Promise.resolve(p),
      );

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 20 });
      expect(cleanupSpy).toHaveBeenCalled();
      // Exactly two page requests; the walk stops once 20 are saved.
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenCalledTimes(2);
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenNthCalledWith(
        1,
        subName,
        {
          limit: 100,
        },
      );
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenNthCalledWith(
        2,
        subName,
        { limit: 100, after: 't3_x' },
      );
    });

    it('stops mid-page at the 20th save: 20 comment fetches, one page, post 21 untouched', async () => {
      const subName = 'AskReddit';
      const subEntity = { id: 'sub-uuid', name: subName, lastScrapedAt: null };

      const cleanupSpy = jest
        .spyOn(service, 'cleanupOldData')
        .mockResolvedValue(undefined);

      mockSubredditRepo.findOneBy.mockResolvedValue(subEntity);
      mockSubredditRepo.save.mockResolvedValue(subEntity);

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
      mockPostRepo.findOneBy.mockResolvedValue(null); // all posts are new
      mockRedditScraper.fetchPostComments.mockResolvedValue([
        {
          id: 'c',
          body: 'hello '.repeat(2600).trim(), // passes the 2500-word guard
          author: 'user',
          score: 10,
          parent_id: 't3_p',
          created_utc: 1719999999,
        },
      ]);
      mockCommentRepo.create.mockImplementation((c): Partial<Comment> => ({
        id: 'c-uuid',
        ...c,
      }));
      mockCommentRepo.save.mockImplementation((c): Promise<Partial<Comment>> =>
        Promise.resolve(c),
      );
      mockPostRepo.create.mockImplementation((p): Partial<Post> => ({
        id: 'p-uuid',
        ...p,
      }));
      mockPostRepo.save.mockImplementation((p): Promise<Partial<Post>> =>
        Promise.resolve(p),
      );

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 20 });
      expect(cleanupSpy).toHaveBeenCalled();
      // Exactly one page request — the walk stops before any further page.
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenCalledTimes(1);
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenCalledWith(subName, {
        limit: 100,
      });
      // The 20th save halts processing mid-page: post 21 is never visited.
      expect(mockRedditScraper.fetchPostComments).toHaveBeenCalledTimes(20);
      expect(mockRedditScraper.fetchPostComments).not.toHaveBeenCalledWith(
        subName,
        'post21',
      );
      const saved = (
        mockPostRepo.save.mock.calls as Array<[Partial<Post>]>
      ).map((call) => call[0].redditId);
      expect(saved).toHaveLength(20);
      expect(saved[19]).toBe('post20');
    });

    it('should scrape new posts and comments, filtering out posts with under 2500 words and capping at 20 saved posts', async () => {
      const subName = 'AskReddit';
      const subEntity = { id: 'sub-uuid', name: subName, lastScrapedAt: null };

      const cleanupSpy = jest
        .spyOn(service, 'cleanupOldData')
        .mockResolvedValue(undefined);

      mockSubredditRepo.findOneBy.mockResolvedValue(subEntity);
      mockSubredditRepo.save.mockResolvedValue(subEntity);

      // We return 3 raw posts.
      // Post 1: 2200 words (Should be skipped due to < 2500)
      // Post 2: 1500 words (Should be skipped due to < 2500)
      // Post 3: 2700 words (Should be saved since >= 2500)
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
      mockPostRepo.findOneBy.mockResolvedValue(null); // None exist in DB yet

      // Mock word count comments
      // post1: 1 comment containing 2200 words
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
      // post2: 1 comment containing 1500 words
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
      // post3: 1 comment containing 2700 words
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

      mockCommentRepo.create.mockImplementation((c): Partial<Comment> => ({
        id: 'c-uuid',
        ...c,
      }));
      mockCommentRepo.save.mockImplementation((c): Promise<Partial<Comment>> =>
        Promise.resolve(c),
      );

      mockPostRepo.create.mockImplementation((p): Partial<Post> => ({
        id: 'p-uuid',
        ...p,
      }));
      mockPostRepo.save.mockImplementation((p): Promise<Partial<Post>> =>
        Promise.resolve(p),
      );

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 1 });
      expect(cleanupSpy).toHaveBeenCalled();
      expect(mockRedditScraper.exists).not.toHaveBeenCalled();
      expect(mockSubredditRepo.findOneBy).toHaveBeenCalledWith({
        name: subName,
      });

      // Verification 1: fetchTopPosts should look at 100 posts max to find high quality content
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenCalledWith(subName, {
        limit: 100,
      });

      // Verification 2: fetchPostComments should have been called for all candidate posts
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

      // Verification 3: Only post3 should be saved in DB. post1 and post2 are skipped due to < 2500 words.
      const saveCalls = mockPostRepo.save.mock.calls;
      const savedPostIds = saveCalls.map(
        (call: [Partial<Post>]) => call[0].redditId,
      );
      expect(savedPostIds).toContain('post3');
      expect(savedPostIds).not.toContain('post1');
      expect(savedPostIds).not.toContain('post2');
    });

    it('should delete subreddit completely when fetchTopPosts reports isInvalid', async () => {
      const subName = 'bannedSub';
      const subEntity = {
        id: 'banned-uuid',
        name: subName,
        lastScrapedAt: null,
      };

      mockSubredditRepo.findOneBy.mockResolvedValue(subEntity);
      mockSubredditRepo.save.mockResolvedValue(subEntity);
      mockRedditScraper.fetchTopPosts.mockResolvedValue({
        posts: [],
        isInvalid: true,
      });

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 0 });
      expect(mockSubredditRepo.delete).toHaveBeenCalledWith({
        id: 'banned-uuid',
      });
      expect(mockRedditScraper.exists).not.toHaveBeenCalled();
      // save() must not run after the delete: TypeORM would re-INSERT the
      // deleted entity (new row with the same name) — the row must stay gone.
      const deleteCall = mockSubredditRepo.delete.mock.invocationCallOrder[0];
      expect(
        mockSubredditRepo.save.mock.invocationCallOrder.every(
          (n) => n < deleteCall,
        ),
      ).toBe(true);
    });

    it('should dedupe a scrape already in-flight via scrapeStartedAt', async () => {
      const subName = 'askreddit';
      const subreddit = Object.assign(new Subreddit(), {
        id: 'sub-1',
        name: subName,
        lastScrapedAt: new Date(Date.now() - 1000),
        scrapeStartedAt: new Date(Date.now() - 10000), // claimed 10s ago
      });
      mockSubredditRepo.findOneBy.mockResolvedValue(subreddit);
      mockSubredditRepo.save.mockResolvedValue(subreddit);

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
      mockSubredditRepo.findOneBy.mockResolvedValue(subreddit);
      mockSubredditRepo.save.mockResolvedValue(subreddit);
      mockRedditScraper.fetchTopPosts.mockResolvedValue({
        posts: [],
        isInvalid: false,
      });

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 0 });
      expect(subreddit.scrapeCooldownUntil).toBeInstanceOf(Date);
      // Cooldown must cover the full 2h window
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
        scrapeStartedAt: new Date(Date.now() - 10000), // in-flight claim
        scrapeCooldownUntil: new Date(Date.now() + 60 * 60 * 1000), // cooling down
      });
      mockSubredditRepo.findOneBy.mockResolvedValue(subreddit);
      mockSubredditRepo.save.mockResolvedValue(subreddit);
      mockRedditScraper.fetchTopPosts.mockResolvedValue({
        posts: [],
        isInvalid: false,
      });

      const result = await service.scrapeSubreddit(subName, true);

      // The scrape actually ran (posts fetched, no separate validation call)
      expect(mockRedditScraper.exists).not.toHaveBeenCalled();
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenCalled();
      expect(result).toEqual({ scrapedPostsCount: 0 });
    });

    it('should save new posts BEFORE purging old ones (per-sub scope)', async () => {
      const subName = 'askreddit';
      const subEntity = { id: 'sub-1', name: subName, lastScrapedAt: null };
      mockSubredditRepo.findOneBy.mockResolvedValue(subEntity);
      mockSubredditRepo.save.mockResolvedValue(subEntity);

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
          body: 'hello '.repeat(2600).trim(), // >= 2500 word guard passes
          author: 'user',
          score: 10,
          parent_id: 't3_p1',
          created_utc: 1719999999,
        },
      ]);
      mockPostRepo.findOneBy.mockResolvedValue(null);
      mockPostRepo.create.mockImplementation((p): Partial<Post> => ({
        id: 'p-uuid',
        ...p,
      }));
      mockPostRepo.save.mockImplementation((p): Promise<Partial<Post>> =>
        Promise.resolve(p),
      );

      const result = await service.scrapeSubreddit(subName);

      expect(result.scrapedPostsCount).toBe(1);
      // Save must happen before the 72h purge
      const saveOrder = mockPostRepo.save.mock.invocationCallOrder[0];
      const deleteOrder = mockPostRepo.delete.mock.invocationCallOrder[0];
      expect(saveOrder).toBeLessThan(deleteOrder);
      // Purge is scoped to this subreddit only (deletes posts older than 72h)
      const deleteCalls = mockPostRepo.delete.mock.calls as unknown as Array<
        [Record<string, unknown>?]
      >;
      const deleteArgs = deleteCalls[0]?.[0] as
        { subredditId?: string; scrapedAt?: Date } | undefined;
      expect(deleteArgs?.subredditId).toBe('sub-1');
      expect(deleteArgs?.scrapedAt).toBeDefined();
    });

    it('stops quietly when the page fetch fails on the first call (was: rethrow)', async () => {
      const subName = 'downSub';
      const subEntity = { id: 'down-uuid', name: subName, lastScrapedAt: null };

      mockSubredditRepo.findOneBy.mockResolvedValue(subEntity);
      mockSubredditRepo.save.mockResolvedValue(subEntity);
      mockRedditScraper.fetchTopPosts.mockRejectedValue(
        new Error('Browser connection lost'),
      );

      const result = await service.scrapeSubreddit(subName);

      expect(result).toEqual({ scrapedPostsCount: 0 });
      expect(mockSubredditRepo.delete).not.toHaveBeenCalled();
      expect(mockSubredditRepo.save).toHaveBeenCalled();
    });
  });

  describe('cleanupOldData', () => {
    it('should delete posts older than the 7-day window (SCRAPE_WINDOW_MS)', async () => {
      mockPostRepo.delete.mockResolvedValue({ affected: 5 });

      await service.cleanupOldData();

      expect(mockPostRepo.delete).toHaveBeenCalled();

      const deleteMock = mockPostRepo.delete;
      const calls = deleteMock.mock.calls as unknown[][];
      const deleteArg = calls[0][0] as {
        scrapedAt: { _value: Date };
      };
      const passedDate = deleteArg.scrapedAt._value;
      const expectedCutoff = Date.now() - SCRAPE_WINDOW_MS;

      // Assert it is within 2 seconds of the shared window constant — the
      // purge cutoff and the stale threshold are ONE knob.
      expect(passedDate.getTime()).toBeCloseTo(expectedCutoff, -3);
    });
  });

  describe('validateSubreddit', () => {
    it('should return true if RedditScraperService.exists returns true', async () => {
      mockRedditScraper.fetchTopPosts.mockResolvedValue([]); // fallback if needed
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
});
