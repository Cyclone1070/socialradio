import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { EntityManager } from '@mikro-orm/postgresql';
import { ContentModule } from './content.module';
import { ScraperService } from './scraper.service';
import { RedditScraperService } from './reddit-scraper.service';
import {
  SubredditSchema,
  PostSchema,
  CommentSchema,
} from '../infrastructure/database/schemas/content.schema';

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
          provide: getRepositoryToken(SubredditSchema),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(PostSchema),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(CommentSchema),
          useValue: { find: jest.fn() },
        },
        {
          provide: EntityManager,
          useValue: {
            persist: jest.fn(),
            flush: jest.fn(),
            persistAndFlush: jest.fn(),
          },
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
