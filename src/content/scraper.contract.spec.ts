import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { EntityManager } from '@mikro-orm/postgresql';
import { ScraperService } from './scraper.service';
import { RedditFetcherContractError } from './reddit-fetcher.contract';
import { RedditScraperService } from './reddit-scraper.service';
import { Subreddit } from './entities/subreddit.entity';
import { Post } from './entities/post.entity';
import {
  CommentSchema,
  PostSchema,
  SubredditSchema,
} from '../infrastructure/database/schemas/content.schema';

/**
 * The fetcher is a separately deployed service, so a payload it stops producing
 * correctly must fail the scrape — never be half-read into the database, and
 * never be mistaken for "this subreddit is gone", which deletes its row.
 */
describe('ScraperService and the fetcher contract', () => {
  let service: ScraperService;

  const subredditRepo = {
    findOne: jest.fn(),
    nativeDelete: jest.fn(),
    nativeUpdate: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
  };
  const postRepo = {
    findOne: jest.fn(),
    nativeDelete: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
  };
  const em = { persist: jest.fn(), flush: jest.fn(), find: jest.fn() };
  const reddit = {
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
          useValue: subredditRepo,
        },
        { provide: getRepositoryToken(PostSchema), useValue: postRepo },
        { provide: getRepositoryToken(CommentSchema), useValue: {} },
        { provide: EntityManager, useValue: em },
        { provide: RedditScraperService, useValue: reddit },
      ],
    }).compile();

    service = module.get<ScraperService>(ScraperService);
    jest.clearAllMocks();
    em.persist.mockReturnThis();
    em.find.mockResolvedValue([]);
    subredditRepo.find.mockResolvedValue([]);
    subredditRepo.count.mockResolvedValue(0);
    postRepo.find.mockResolvedValue([]);
    postRepo.count.mockResolvedValue(0);
    subredditRepo.findOne.mockResolvedValue(
      Object.assign(new Subreddit(), {
        id: 'sub-uuid',
        name: 'askreddit',
        lastScrapedAt: null,
      }),
    );
  });

  it('stops the walk and keeps the row when a payload breaks the contract', async () => {
    reddit.fetchTopPosts.mockRejectedValue(
      new RedditFetcherContractError(
        '/top-posts/askreddit',
        'posts.0.title: Invalid input: expected string, received undefined',
      ),
    );
    reddit.fetchPostComments.mockResolvedValue([]);

    await service.scrapeSubreddit('askreddit', true);

    // A contract break must not be read as "this subreddit is gone": that deletes
    // the row, so a rename upstream would quietly evict real subreddits.
    expect(reddit.fetchPostComments).not.toHaveBeenCalled();
    expect(postRepo.findOne).not.toHaveBeenCalled();
    expect(em.persist).not.toHaveBeenCalledWith(expect.any(Post));
    expect(subredditRepo.nativeDelete).not.toHaveBeenCalled();
  });

  it('still deletes the row when the fetcher reports the subreddit as invalid', async () => {
    reddit.fetchTopPosts.mockResolvedValue({
      posts: [],
      after: null,
      isInvalid: true,
    });

    await service.scrapeSubreddit('askreddit', true);

    expect(subredditRepo.nativeDelete).toHaveBeenCalled();
  });
});
