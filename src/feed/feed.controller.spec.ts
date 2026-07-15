import { Test, TestingModule } from '@nestjs/testing';
import { FeedController } from './feed.controller';
import { ScraperService } from './scraper.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Subreddit } from '../domain/entities/subreddit.entity';
import { Post } from './entities/post.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

describe('FeedController', () => {
  let controller: FeedController;

  const mockScraperService = {
    scrapeSubreddit: jest.fn(),
    cleanupOldData: jest.fn(),
  };

  const mockSubredditRepo = {
    find: jest.fn(),
  };

  const mockPostRepo = {
    countBy: jest.fn(),
  };

  beforeEach(async () => {
    const mockGuard = {
      canActivate: jest.fn(() => true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeedController],
      providers: [
        { provide: ScraperService, useValue: mockScraperService },
        { provide: getRepositoryToken(Subreddit), useValue: mockSubredditRepo },
        { provide: getRepositoryToken(Post), useValue: mockPostRepo },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<FeedController>(FeedController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('scrape', () => {
    it('should trigger scraper service for the subreddit', async () => {
      mockScraperService.scrapeSubreddit.mockResolvedValue(undefined);

      await controller.scrape({ subredditName: 'AskReddit' });

      expect(mockScraperService.scrapeSubreddit).toHaveBeenCalledWith(
        'askreddit',
      );
    });
  });

  describe('cleanCache', () => {
    it('should trigger cleanupOldData on scraper service', async () => {
      mockScraperService.cleanupOldData.mockResolvedValue(undefined);

      await controller.cleanCache();

      expect(mockScraperService.cleanupOldData).toHaveBeenCalled();
    });
  });

  describe('getSubreddits', () => {
    it('should return list of subreddits with post counts', async () => {
      const subs = [
        { id: 'sub-1', name: 'news', lastScrapedAt: new Date() },
        { id: 'sub-2', name: 'pics', lastScrapedAt: null },
      ];
      mockSubredditRepo.find.mockResolvedValue(subs);
      mockPostRepo.countBy
        .mockResolvedValueOnce(10) // for sub-1
        .mockResolvedValueOnce(0); // for sub-2

      const result = await controller.getSubreddits();

      expect(mockSubredditRepo.find).toHaveBeenCalled();
      expect(mockPostRepo.countBy).toHaveBeenNthCalledWith(1, {
        subredditId: 'sub-1',
      });
      expect(mockPostRepo.countBy).toHaveBeenNthCalledWith(2, {
        subredditId: 'sub-2',
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'sub-1',
        name: 'news',
        lastScrapedAt: subs[0].lastScrapedAt,
        postCount: 10,
      });
      expect(result[1]).toEqual({
        id: 'sub-2',
        name: 'pics',
        lastScrapedAt: null,
        postCount: 0,
      });
    });
  });
});
