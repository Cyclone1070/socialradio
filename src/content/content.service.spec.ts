import { EntityRepository } from '@mikro-orm/postgresql';
import { ContentService } from './content.service';
import { Subreddit } from './entities/subreddit.entity';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';
import { ScraperService } from './scraper.service';
import { ScrapeQueueService } from './scrape-queue.service';

describe('ContentService', () => {
  const subredditRepo = {} as EntityRepository<Subreddit>;
  const postRepo = {} as EntityRepository<Post>;
  const commentRepo = {} as EntityRepository<Comment>;
  const scraper = { ensureSubreddit: jest.fn() };
  const queue = { enqueue: jest.fn() };
  let service: ContentService;

  beforeEach(() => {
    jest.clearAllMocks();
    scraper.ensureSubreddit.mockResolvedValue(undefined);
    queue.enqueue.mockResolvedValue({ id: 'job-1' });
    service = new ContentService(
      subredditRepo,
      postRepo,
      commentRepo,
      scraper as unknown as ScraperService,
      queue as unknown as ScrapeQueueService,
    );
  });

  it('creates the subreddit row before enqueueing a scrape', async () => {
    await service.scrapeSubreddit('AskReddit');

    expect(scraper.ensureSubreddit).toHaveBeenCalledWith('AskReddit');
    expect(queue.enqueue).toHaveBeenCalledWith('AskReddit');
    expect(scraper.ensureSubreddit.mock.invocationCallOrder[0]).toBeLessThan(
      queue.enqueue.mock.invocationCallOrder[0],
    );
  });

  it('does not enqueue when the row cannot be created', async () => {
    scraper.ensureSubreddit.mockRejectedValue(new Error('db down'));

    await expect(service.scrapeSubreddit('AskReddit')).rejects.toThrow(
      'db down',
    );
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
