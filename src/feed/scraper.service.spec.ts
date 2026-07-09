import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ScraperService } from './scraper.service';
import { RedditApiService } from './reddit-api.service';
import { TopicService } from './topic.service';
import { Subreddit } from '../domain/entities/subreddit.entity';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';
import { Topic } from '../domain/entities/topic.entity';

// Mock the huggingface transformers library to avoid native binary loading issues in Jest
jest.mock('@huggingface/transformers', () => ({
  pipeline: jest.fn().mockResolvedValue(jest.fn()),
}));

describe('ScraperService', () => {
  let service: ScraperService;

  const mockSubredditRepo = {
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
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

  const mockTopicRepo = {
    delete: jest.fn(),
  };

  const mockRedditApi = {
    fetchTopPosts: jest.fn(),
    fetchPostComments: jest.fn(),
  };

  const mockTopicService = {
    categorizeNewPosts: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScraperService,
        { provide: getRepositoryToken(Subreddit), useValue: mockSubredditRepo },
        { provide: getRepositoryToken(Post), useValue: mockPostRepo },
        { provide: getRepositoryToken(Comment), useValue: mockCommentRepo },
        { provide: getRepositoryToken(Topic), useValue: mockTopicRepo },
        { provide: RedditApiService, useValue: mockRedditApi },
        { provide: TopicService, useValue: mockTopicService },
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
      expect(mockRedditApi.fetchTopPosts).toHaveBeenCalledWith(subName, 10);
      expect(mockRedditApi.fetchPostComments).toHaveBeenCalledWith(
        subName,
        'post1',
        5,
      );
      expect(mockTopicService.categorizeNewPosts).toHaveBeenCalledWith(
        'sub-uuid',
        [createdPost],
      );
    });
  });

  describe('cleanupOldData', () => {
    it('should delete posts and topics older than 24 hours', async () => {
      mockPostRepo.delete.mockResolvedValue({ affected: 5 });
      mockTopicRepo.delete.mockResolvedValue({ affected: 2 });

      await service.cleanupOldData();

      expect(mockPostRepo.delete).toHaveBeenCalled();
      expect(mockTopicRepo.delete).toHaveBeenCalled();
    });
  });
});
