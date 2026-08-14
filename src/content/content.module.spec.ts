import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ContentModule } from './content.module';
import { ScraperService } from './scraper.service';
import { RedditScraperService } from './reddit-scraper.service';
import { Subreddit } from './entities/subreddit.entity';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';

describe('ContentModule Integration', () => {
  let scraperService: ScraperService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScraperService,
        {
          provide: RedditScraperService,
          useValue: { fetchTopPosts: jest.fn() },
        },
        {
          provide: getRepositoryToken(Subreddit),
          useValue: { findOneBy: jest.fn() },
        },
        {
          provide: getRepositoryToken(Post),
          useValue: { findOneBy: jest.fn() },
        },
        {
          provide: getRepositoryToken(Comment),
          useValue: { find: jest.fn() },
        },
      ],
    }).compile();

    scraperService = module.get<ScraperService>(ScraperService);
  });

  it('should export ContentModule and instantiate ScraperService', () => {
    expect(ContentModule).toBeDefined();
    expect(scraperService).toBeDefined();
  });
});
