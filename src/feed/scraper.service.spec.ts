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

  const mockRedditApi = {
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
        { provide: RedditScraperService, useValue: mockRedditApi },
      ],
    }).compile();

    service = module.get<ScraperService>(ScraperService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('scrapeSubreddit', () => {
    it('should scrape new posts and comments, then categorize them', async () => {
      const subName = 'AskReddit';
      const subEntity = { id: 'sub-uuid', name: subName, lastScrapedAt: null };

      const cleanupSpy = jest
        .spyOn(service, 'cleanupOldData')
        .mockResolvedValue(undefined);

      mockSubredditRepo.findOneBy.mockResolvedValue(subEntity);
      mockSubredditRepo.save.mockResolvedValue(subEntity);
      mockRedditApi.exists.mockResolvedValue(true); // Subreddit exists

      const rawPosts = [
        {
          id: 'post1',
          title: 'Title 1',
          selftext: 'Body 1',
          author: 'caller_user',
          score: 100,
          created_utc: 1719999999,
        },
      ];
      mockRedditApi.fetchTopPosts.mockResolvedValue(rawPosts);
      mockPostRepo.findOneBy.mockResolvedValue(null); // Post doesn't exist yet

      const rawComments = [
        {
          id: 'comment1',
          body: 'Comment Body',
          author: 'caller_user', // OP
          score: 5,
          parent_id: 't3_post1',
          created_utc: 1719999999,
        },
        {
          id: 'reply1',
          body: 'Reply Body',
          author: 'other_user', // Not OP
          score: 2,
          parent_id: 't1_comment1', // replies to comment1
          created_utc: 1720000000,
        },
      ];
      mockRedditApi.fetchPostComments.mockResolvedValue(rawComments);

      const createdComment = { id: 'c-uuid', redditId: 'comment1' };
      mockCommentRepo.create.mockReturnValue(createdComment);
      mockCommentRepo.save.mockResolvedValue(createdComment);

      const createdPost = { id: 'p-uuid', redditId: 'post1' };
      mockPostRepo.create.mockReturnValue(createdPost);
      mockPostRepo.save.mockImplementation((p) => Promise.resolve(p));

      await service.scrapeSubreddit(subName);

      expect(cleanupSpy).toHaveBeenCalled();
      expect(mockRedditApi.exists).toHaveBeenCalledWith(subName);
      expect(mockCommentRepo.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          redditId: 'comment1',
          isOp: true,
          parentRedditId: null,
        }) as unknown,
      );
      expect(mockCommentRepo.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          redditId: 'reply1',
          isOp: false,
          parentRedditId: 'comment1',
        }) as unknown,
      );
      expect(mockSubredditRepo.findOneBy).toHaveBeenCalledWith({
        name: subName,
      });
      expect(mockRedditApi.fetchTopPosts).toHaveBeenCalledWith(subName, 20);
      expect(mockRedditApi.fetchPostComments).toHaveBeenCalledWith(
        subName,
        'post1',
        50,
      );
    });

    it('should delete subreddit completely and resolve gracefully when validateSubreddit returns false', async () => {
      const subName = 'bannedSub';
      const subEntity = {
        id: 'banned-uuid',
        name: subName,
        lastScrapedAt: null,
      };

      mockSubredditRepo.findOneBy.mockResolvedValue(subEntity);
      mockRedditApi.exists.mockResolvedValue(false); // Invalid subreddit

      await expect(service.scrapeSubreddit(subName)).resolves.not.toThrow();

      expect(mockSubredditRepo.delete).toHaveBeenCalledWith({
        id: 'banned-uuid',
      });
      expect(mockRedditApi.fetchTopPosts).not.toHaveBeenCalled();
    });

    it('should rethrow error on unexpected scraper execution errors', async () => {
      const subName = 'downSub';
      const subEntity = { id: 'down-uuid', name: subName, lastScrapedAt: null };

      mockSubredditRepo.findOneBy.mockResolvedValue(subEntity);
      mockRedditApi.exists.mockResolvedValue(true);
      mockRedditApi.fetchTopPosts.mockRejectedValue(
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
      mockRedditApi.fetchTopPosts.mockResolvedValue([]); // fallback if needed
      mockRedditApi.exists.mockResolvedValue(true);

      const result = await service.validateSubreddit('AskReddit');

      expect(result).toBe(true);
      expect(mockRedditApi.exists).toHaveBeenCalledWith('AskReddit');
    });

    it('should return false if RedditScraperService.exists returns false', async () => {
      mockRedditApi.exists.mockResolvedValue(false);

      const result = await service.validateSubreddit('private');

      expect(result).toBe(false);
      expect(mockRedditApi.exists).toHaveBeenCalledWith('private');
    });
  });
});
