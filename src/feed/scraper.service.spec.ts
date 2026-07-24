import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ScraperService } from './scraper.service';
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
    it('should scrape new posts and comments, filtering out posts with under 2500 words and capping at 20 saved posts', async () => {
      const subName = 'AskReddit';
      const subEntity = { id: 'sub-uuid', name: subName, lastScrapedAt: null };

      const cleanupSpy = jest
        .spyOn(service, 'cleanupOldData')
        .mockResolvedValue(undefined);

      mockSubredditRepo.findOneBy.mockResolvedValue(subEntity);
      mockSubredditRepo.save.mockResolvedValue(subEntity);
      mockRedditScraper.exists.mockResolvedValue(true);

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
      mockRedditScraper.fetchTopPosts.mockResolvedValue(rawPosts);
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

      mockRedditScraper.fetchPostComments.mockImplementation((sub, postId) => {
        if (postId === 'post1') return Promise.resolve(post1Comments);
        if (postId === 'post2') return Promise.resolve(post2Comments);
        if (postId === 'post3') return Promise.resolve(post3Comments);
        return Promise.resolve([]);
      });

      mockCommentRepo.create.mockImplementation((c) => ({
        id: 'c-uuid',
        ...c,
      }));
      mockCommentRepo.save.mockImplementation((c) => Promise.resolve(c));

      mockPostRepo.create.mockImplementation((p) => ({ id: 'p-uuid', ...p }));
      mockPostRepo.save.mockImplementation((p) => Promise.resolve(p));

      await service.scrapeSubreddit(subName);

      expect(cleanupSpy).toHaveBeenCalled();
      expect(mockRedditScraper.exists).toHaveBeenCalledWith(subName);
      expect(mockSubredditRepo.findOneBy).toHaveBeenCalledWith({
        name: subName,
      });

      // Verification 1: fetchTopPosts should look at 100 posts max to find high quality content
      expect(mockRedditScraper.fetchTopPosts).toHaveBeenCalledWith(
        subName,
        100,
      );

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
      const savedPostIds = saveCalls.map((call: any[]) => call[0].redditId);
      expect(savedPostIds).toContain('post3');
      expect(savedPostIds).not.toContain('post1');
      expect(savedPostIds).not.toContain('post2');
    });

    it('should delete subreddit completely and resolve gracefully when validateSubreddit returns false', async () => {
      const subName = 'bannedSub';
      const subEntity = {
        id: 'banned-uuid',
        name: subName,
        lastScrapedAt: null,
      };

      mockSubredditRepo.findOneBy.mockResolvedValue(subEntity);
      mockRedditScraper.exists.mockResolvedValue(false); // Invalid subreddit

      await expect(service.scrapeSubreddit(subName)).resolves.not.toThrow();

      expect(mockSubredditRepo.delete).toHaveBeenCalledWith({
        id: 'banned-uuid',
      });
      expect(mockRedditScraper.fetchTopPosts).not.toHaveBeenCalled();
    });

    it('should rethrow error on unexpected scraper execution errors', async () => {
      const subName = 'downSub';
      const subEntity = { id: 'down-uuid', name: subName, lastScrapedAt: null };

      mockSubredditRepo.findOneBy.mockResolvedValue(subEntity);
      mockRedditScraper.exists.mockResolvedValue(true);
      mockRedditScraper.fetchTopPosts.mockRejectedValue(
        new Error('Browser connection lost'),
      );

      await expect(service.scrapeSubreddit(subName)).rejects.toThrow(
        'Browser connection lost',
      );
      expect(mockSubredditRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('cleanupOldData', () => {
    it('should delete posts older than 72 hours', async () => {
      mockPostRepo.delete.mockResolvedValue({ affected: 5 });

      await service.cleanupOldData();

      expect(mockPostRepo.delete).toHaveBeenCalled();

      const deleteMock = mockPostRepo.delete;
      const calls = deleteMock.mock.calls as unknown[][];
      const deleteArg = calls[0][0] as {
        scrapedAt: { _value: Date };
      };
      const passedDate = deleteArg.scrapedAt._value;
      const expectedCutoff = Date.now() - 72 * 60 * 60 * 1000;

      // Assert it is within 5 seconds of our calculated cutoff
      expect(passedDate.getTime()).toBeCloseTo(expectedCutoff, -4);
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
