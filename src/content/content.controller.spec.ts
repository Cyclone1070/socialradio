import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { ContentController } from './content.controller';
import { ScraperService } from './scraper.service';
import {
  SubredditSchema,
  PostSchema,
} from '../infrastructure/database/schemas/content.schema';
import { JwtAuthGuard, RolesGuard } from '../infrastructure/auth';

describe('ContentController', () => {
  let controller: ContentController;

  const mockScraperService = {
    scrapeSubreddit: jest.fn(),
    cleanupOldData: jest.fn(),
  };

  const mockSubredditRepo = {
    findAll: jest.fn(),
  };

  const mockPostRepo = {
    count: jest.fn(),
  };

  beforeEach(async () => {
    const mockGuard = {
      canActivate: jest.fn(() => true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContentController],
      providers: [
        { provide: ScraperService, useValue: mockScraperService },
        {
          provide: getRepositoryToken(SubredditSchema),
          useValue: mockSubredditRepo,
        },
        { provide: getRepositoryToken(PostSchema), useValue: mockPostRepo },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(RolesGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<ContentController>(ContentController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('scrape', () => {
    it('should trigger scraper service for the subreddit and return the scrape result', async () => {
      mockScraperService.scrapeSubreddit.mockResolvedValue({
        scrapedPostsCount: 2,
      });

      const result = await controller.scrape({
        subredditName: 'AskReddit',
      });

      expect(result).toEqual({ scrapedPostsCount: 2 });
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
      mockSubredditRepo.findAll.mockResolvedValue(subs);
      mockPostRepo.count.mockResolvedValueOnce(10).mockResolvedValueOnce(0);

      const result = await controller.getSubreddits();

      expect(mockSubredditRepo.findAll).toHaveBeenCalled();
      expect(mockPostRepo.count).toHaveBeenNthCalledWith(1, {
        subreddit: 'sub-1',
      });
      expect(mockPostRepo.count).toHaveBeenNthCalledWith(2, {
        subreddit: 'sub-2',
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
