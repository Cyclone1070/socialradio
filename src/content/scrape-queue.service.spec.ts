import { EntityManager } from '@mikro-orm/postgresql';
import { ScrapeQueueService } from './scrape-queue.service';

describe('ScrapeQueueService', () => {
  let service: ScrapeQueueService;
  const execute = jest.fn();

  beforeEach(() => {
    execute.mockReset();
    const em = { execute } as unknown as EntityManager;
    service = new ScrapeQueueService(em);
  });

  describe('enqueue', () => {
    it('upserts by dedupe key and notifies the returned id', async () => {
      execute.mockResolvedValueOnce([{ id: 'job-1' }]);
      execute.mockResolvedValueOnce([]);

      const result = await service.enqueue('AskReddit');

      expect(result).toEqual({ id: 'job-1' });
      expect(execute).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('on conflict ("dedupe_key") where "state" in'),
        ['subreddit:askreddit', 'askreddit'],
      );
      expect(execute).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('pg_notify'),
        ['scrape_jobs', 'job-1'],
      );
    });

    it('still notifies when the insert hit the dedupe index', async () => {
      execute.mockResolvedValueOnce([{ id: 'existing-job' }]);
      execute.mockResolvedValueOnce([]);

      await service.enqueue('news');

      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('pg_notify'),
        ['scrape_jobs', 'existing-job'],
      );
    });
  });

  describe('status', () => {
    it('reads one job by id', async () => {
      const runAt = new Date();
      execute.mockResolvedValueOnce([
        {
          id: 'job-1',
          subreddit: 'news',
          state: 'queued',
          attempts: 2,
          run_at: runAt,
          last_error: 'boom',
          finished_at: null,
        },
      ]);

      await expect(service.status('job-1')).resolves.toEqual({
        id: 'job-1',
        subreddit: 'news',
        state: 'queued',
        attempts: 2,
        runAt,
        lastError: 'boom',
        finishedAt: null,
      });
      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('from "scrape_job"'),
        ['job-1'],
      );
    });

    it('returns null for an unknown job', async () => {
      execute.mockResolvedValueOnce([]);
      await expect(service.status('missing')).resolves.toBeNull();
    });
  });

  describe('claim', () => {
    it('claims queued or stale running jobs with skip locked', async () => {
      const leasedUntil = new Date();
      execute.mockResolvedValueOnce([
        {
          id: 'job-1',
          dedupe_key: 'subreddit:news',
          subreddit: 'news',
          attempts: 2,
          lease_owner: 'worker-1',
          leased_until: leasedUntil,
        },
      ]);

      const job = await service.claim('worker-1', 1000);

      expect(job).toEqual({
        id: 'job-1',
        dedupeKey: 'subreddit:news',
        subreddit: 'news',
        attempts: 2,
        leaseOwner: 'worker-1',
        leasedUntil,
      });
      const [sql] = execute.mock.calls[0] as unknown as [string, unknown[]];
      expect(sql).toContain('for update skip locked');
      expect(sql).toContain(`"leased_until" < now()`);
      expect(sql).toContain(`"state" = 'queued'`);
    });

    it('returns null when nothing is claimable', async () => {
      execute.mockResolvedValueOnce([]);
      await expect(service.claim('worker-1')).resolves.toBeNull();
    });
  });

  describe('lease ownership', () => {
    it('renews only when the caller owns the running job', async () => {
      execute.mockResolvedValueOnce([]);
      await expect(service.renew('job-1', 'worker-1')).resolves.toBe(false);

      execute.mockResolvedValueOnce([{ id: 'job-1' }]);
      await expect(service.renew('job-1', 'worker-1')).resolves.toBe(true);
    });

    it('completes only when the caller owns the running job', async () => {
      execute.mockResolvedValueOnce([]);
      await expect(service.complete('job-1', 'worker-1')).resolves.toBe(false);

      execute.mockResolvedValueOnce([{ id: 'job-1' }]);
      await expect(service.complete('job-1', 'worker-1')).resolves.toBe(true);
    });
  });

  describe('fail', () => {
    it('fences the failure update to a still-live lease', async () => {
      execute.mockResolvedValueOnce([{ state: 'queued', run_at: new Date() }]);

      await service.fail('job-1', 'worker-1', 'boom', 3);

      const [sql] = execute.mock.calls[0] as unknown as [string, unknown[]];
      expect(sql).toContain(`"leased_until" > now()`);
    });

    it('returns the resulting state and retry time from the retry update', async () => {
      const runAt = new Date(Date.now() + 120_000);
      execute.mockResolvedValueOnce([{ state: 'queued', run_at: runAt }]);
      await expect(
        service.fail('job-1', 'worker-1', 'boom', 3),
      ).resolves.toEqual({ state: 'queued', runAt });

      const failedRunAt = new Date();
      execute.mockResolvedValueOnce([{ state: 'failed', run_at: failedRunAt }]);
      await expect(
        service.fail('job-1', 'worker-1', 'boom', 3),
      ).resolves.toEqual({ state: 'failed', runAt: failedRunAt });

      execute.mockResolvedValueOnce([]);
      await expect(
        service.fail('job-1', 'worker-1', 'boom', 3),
      ).resolves.toBeNull();
    });
  });
});
