import { ConfigService } from '@nestjs/config';
import { RequestContext } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { ScrapeWorkerService } from './scrape-worker.service';
import { ScrapeJob, ScrapeQueueService } from './scrape-queue.service';
import { ScraperService } from './scraper.service';

type WorkerInternals = {
  running: boolean;
  drain(): Promise<void>;
};

function job(id: string): ScrapeJob {
  return {
    id,
    dedupeKey: `subreddit:${id}`,
    subreddit: id,
    attempts: 1,
    leaseOwner: 'worker-1',
    leasedUntil: new Date(Date.now() + 60_000),
  };
}

describe('ScrapeWorkerService', () => {
  const queue = {
    claim: jest.fn(),
    renew: jest.fn(),
    complete: jest.fn(),
    fail: jest.fn(),
  };
  const scraper = { scrapeSubreddit: jest.fn() };
  const config = { get: jest.fn() };
  let worker: ScrapeWorkerService;
  let internals: WorkerInternals;

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(RequestContext, 'create')
      .mockImplementation(((_em: unknown, fn: () => Promise<void>) =>
        fn()) as typeof RequestContext.create);
    config.get.mockReturnValue(undefined);
    queue.renew.mockResolvedValue(true);
    queue.complete.mockResolvedValue(true);
    queue.fail.mockResolvedValue({
      state: 'queued',
      runAt: new Date(Date.now() + 60_000),
    });
    scraper.scrapeSubreddit.mockResolvedValue({ scrapedPostsCount: 0 });
    worker = new ScrapeWorkerService(
      queue as unknown as ScrapeQueueService,
      scraper as unknown as ScraperService,
      config as unknown as ConfigService,
      {} as EntityManager,
    );
    internals = worker as unknown as WorkerInternals;
    internals.running = true;
  });

  it('drains claimable jobs and marks each one done', async () => {
    queue.claim
      .mockResolvedValueOnce(job('news'))
      .mockResolvedValueOnce(job('funny'))
      .mockResolvedValueOnce(null);

    await internals.drain();

    expect(scraper.scrapeSubreddit).toHaveBeenCalledTimes(2);
    expect(scraper.scrapeSubreddit).toHaveBeenNthCalledWith(1, 'news');
    expect(scraper.scrapeSubreddit).toHaveBeenNthCalledWith(2, 'funny');
    expect(queue.complete).toHaveBeenCalledTimes(2);
    expect(queue.complete).toHaveBeenCalledWith('news', expect.any(String));
    expect(queue.fail).not.toHaveBeenCalled();
  });

  it('treats a failed walk as a job failure, not as success', async () => {
    queue.claim.mockResolvedValueOnce(job('news')).mockResolvedValueOnce(null);
    scraper.scrapeSubreddit.mockResolvedValue({
      scrapedPostsCount: 0,
      failed: true,
    });

    await internals.drain();

    expect(queue.fail).toHaveBeenCalledWith(
      'news',
      expect.any(String),
      'the scrape walk could not reach the fetcher',
      3,
    );
    expect(queue.complete).not.toHaveBeenCalled();
    await worker.onApplicationShutdown();
  });

  it('requeues when the subreddit claim is still held by another run', async () => {
    queue.claim.mockResolvedValueOnce(job('news')).mockResolvedValueOnce(null);
    scraper.scrapeSubreddit.mockResolvedValue({
      scrapedPostsCount: 0,
      claimHeld: true,
    });

    await internals.drain();

    expect(queue.fail).toHaveBeenCalledWith(
      'news',
      expect.any(String),
      'another scrape still holds the subreddit claim',
      3,
    );
    expect(queue.complete).not.toHaveBeenCalled();
  });

  it('records a failure and lets the queue decide whether to retry', async () => {
    queue.claim.mockResolvedValueOnce(job('news')).mockResolvedValueOnce(null);
    scraper.scrapeSubreddit.mockRejectedValue(new Error('reddit exploded'));

    await internals.drain();

    expect(queue.fail).toHaveBeenCalledWith(
      'news',
      expect.any(String),
      'reddit exploded',
      3,
    );
    expect(queue.complete).not.toHaveBeenCalled();
  });
});
