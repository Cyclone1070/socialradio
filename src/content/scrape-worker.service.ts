import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RequestContext } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { ScraperService } from './scraper.service';
import {
  DEFAULT_SCRAPE_LEASE_MS,
  DEFAULT_SCRAPE_MAX_ATTEMPTS,
  SCRAPE_JOB_CHANNEL,
  ScrapeJob,
  ScrapeQueueService,
} from './scrape-queue.service';
import { createServiceLogger } from '../infrastructure/logging/logging.module';

const DEFAULT_SWEEP_MS = 5 * 60 * 1000;
const RECONNECT_MS = 5000;

/**
 * Claims and executes scrape jobs. One job at a time per process: the fetcher's
 * Pacer serialises reddit traffic, so extra worker concurrency buys nothing and
 * only muddies lease accounting.
 *
 * Wake-ups are LISTEN notifications, a claim on startup, and a five-minute
 * sweep. No per-second polling.
 */
@Injectable()
export class ScrapeWorkerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = createServiceLogger(ScrapeWorkerService.name);
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly sweepMs: number;
  private listener?: Client;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private sweepTimer?: ReturnType<typeof setInterval>;
  private running = false;
  private draining = false;
  private pendingWake = false;

  constructor(
    private readonly queue: ScrapeQueueService,
    private readonly scraper: ScraperService,
    private readonly config: ConfigService,
    private readonly em: EntityManager,
  ) {
    this.leaseMs = this.number('SCRAPE_LEASE_MS', DEFAULT_SCRAPE_LEASE_MS);
    this.maxAttempts = this.number(
      'SCRAPE_MAX_ATTEMPTS',
      DEFAULT_SCRAPE_MAX_ATTEMPTS,
    );
    this.sweepMs = this.number('SCRAPE_SWEEP_MS', DEFAULT_SWEEP_MS);
  }

  async onApplicationBootstrap(): Promise<void> {
    this.running = true;
    this.logger.info(
      {
        workerId: this.workerId,
        leaseMs: this.leaseMs,
        sweepMs: this.sweepMs,
        maxAttempts: this.maxAttempts,
      },
      'scrape worker starting',
    );
    await this.connect();
    this.sweepTimer = setInterval(() => {
      void this.drain();
    }, this.sweepMs);
    this.sweepTimer.unref?.();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.listener) {
      const listener = this.listener;
      this.listener = undefined;
      await listener.end().catch(() => undefined);
    }
  }

  private number(name: string, fallback: number): number {
    const raw = this.config.get<string>(name);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private databaseUrl(): string {
    return (
      this.config.get<string>('DATABASE_URL') ??
      'postgresql://postgres:postgres@localhost:5432/socialradio'
    );
  }

  private async connect(): Promise<void> {
    if (!this.running) return;
    const client = new Client({ connectionString: this.databaseUrl() });
    client.on('notification', () => {
      this.pendingWake = true;
      void this.drain();
    });
    client.on('error', (err) => {
      this.logger.warn({ err }, 'scrape queue listener error');
      void this.disconnect();
    });
    try {
      await client.connect();
      await client.query(`listen ${SCRAPE_JOB_CHANNEL}`);
      this.listener = client;
      this.logger.info('scrape queue listener connected');
      await this.drain();
    } catch (err: unknown) {
      this.logger.warn({ err }, 'scrape queue listener connect failed');
      await client.end().catch(() => undefined);
      this.scheduleReconnect();
    }
  }

  private async disconnect(): Promise<void> {
    const listener = this.listener;
    this.listener = undefined;
    if (listener) await listener.end().catch(() => undefined);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, RECONNECT_MS);
    this.reconnectTimer.unref?.();
  }

  private async drain(): Promise<void> {
    if (this.draining || !this.running) return;
    this.draining = true;
    try {
      do {
        this.pendingWake = false;
        while (this.running) {
          const job = await this.queue.claim(this.workerId, this.leaseMs);
          if (!job) break;
          await this.execute(job);
        }
      } while (this.pendingWake && this.running);
    } catch (err: unknown) {
      this.logger.error({ err }, 'scrape worker drain failed');
    } finally {
      this.draining = false;
    }
  }

  /** One-shot wake for a backed-off retry; the idle sweep is the fallback. */
  private scheduleRetry(at: Date): void {
    if (!this.running) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const delayMs = Math.max(0, at.getTime() - Date.now());
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.drain();
    }, delayMs);
    this.retryTimer.unref?.();
  }

  private async execute(job: ScrapeJob): Promise<void> {
    let leaseLost = false;
    const heartbeat = setInterval(
      () => {
        void this.queue
          .renew(job.id, this.workerId, this.leaseMs)
          .then((renewed) => {
            if (!renewed) leaseLost = true;
          })
          .catch((err: unknown) => {
            this.logger.warn(
              { err, jobId: job.id },
              'scrape lease renew failed',
            );
            leaseLost = true;
          });
      },
      Math.max(1000, Math.floor(this.leaseMs / 3)),
    );
    heartbeat.unref?.();

    try {
      this.logger.info(
        { jobId: job.id, subreddit: job.subreddit, attempt: job.attempts },
        'scrape job started',
      );
      // The app serves each scrape inside an HTTP request context; the worker
      // has no request, so it opens its own MikroORM context for the walk.
      const result = await RequestContext.create(this.em, () =>
        this.scraper.scrapeSubreddit(job.subreddit),
      );
      if (result.failed) {
        throw new Error('the scrape walk could not reach the fetcher');
      }
      if (leaseLost) {
        this.logger.warn(
          { jobId: job.id },
          'scrape finished after losing its lease; result not marked done',
        );
        return;
      }
      const completed = await this.queue.complete(job.id, this.workerId);
      if (!completed) {
        this.logger.warn(
          { jobId: job.id },
          'scrape completed but the lease was no longer ours',
        );
      }
    } catch (err: unknown) {
      if (leaseLost) {
        this.logger.warn(
          { jobId: job.id, err },
          'scrape failed after losing its lease; not retried by this worker',
        );
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      const failure = await this.queue
        .fail(job.id, this.workerId, message, this.maxAttempts)
        .catch((failErr: unknown) => {
          this.logger.error(
            { jobId: job.id, err: failErr },
            'scrape job failure could not be recorded',
          );
          return null;
        });
      if (failure?.state === 'queued') {
        this.scheduleRetry(failure.runAt);
      }
      this.logger.warn(
        { jobId: job.id, state: failure?.state, err: message },
        'scrape job failed',
      );
    } finally {
      clearInterval(heartbeat);
    }
  }
}
