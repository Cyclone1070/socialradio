import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';

export const SCRAPE_JOB_CHANNEL = 'scrape_jobs';
export const DEFAULT_SCRAPE_LEASE_MS = 5 * 60 * 1000;
export const DEFAULT_SCRAPE_MAX_ATTEMPTS = 3;

export interface ScrapeFailureResult {
  state: 'queued' | 'failed';
  runAt: Date;
}

export interface ScrapeJob {
  id: string;
  dedupeKey: string;
  subreddit: string;
  attempts: number;
  leaseOwner: string;
  leasedUntil: Date;
}

interface JobRow {
  id: string;
  dedupe_key: string;
  subreddit: string;
  attempts: number;
  lease_owner: string;
  leased_until: Date | string;
}

function toJob(row: JobRow): ScrapeJob {
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
    subreddit: row.subreddit,
    attempts: row.attempts,
    leaseOwner: row.lease_owner,
    leasedUntil: new Date(row.leased_until),
  };
}

/**
 * The durable scrape queue.
 *
 * Enqueue is a single upsert: a duplicate request for a live job only bumps
 * `requested_at`, and one for a stale `running` job leaves it for the next
 * claim, which treats an expired lease as claimable. Either way the returned id
 * is notified, so a duplicate request is also the recovery signal.
 */
@Injectable()
export class ScrapeQueueService {
  constructor(private readonly em: EntityManager) {}

  async enqueue(subreddit: string): Promise<{ id: string }> {
    const normalized = subreddit.trim().toLowerCase();
    const dedupeKey = `subreddit:${normalized}`;
    const rows = await this.em.execute<Array<{ id: string }>>(
      `insert into "scrape_job" ("dedupe_key", "subreddit", "state", "requested_at", "run_at")
       values (?, ?, 'queued', now(), now())
       on conflict ("dedupe_key") where "state" in ('queued', 'running')
       do update set "requested_at" = now()
       returning "id"`,
      [dedupeKey, normalized],
    );
    const id = rows[0].id;
    await this.em.execute(`select pg_notify(?, ?)`, [SCRAPE_JOB_CHANNEL, id]);
    return { id };
  }

  async claim(
    workerId: string,
    leaseMs: number = DEFAULT_SCRAPE_LEASE_MS,
  ): Promise<ScrapeJob | null> {
    const rows = await this.em.execute<JobRow[]>(
      `update "scrape_job"
       set "state" = 'running',
           "lease_owner" = ?,
           "leased_until" = now() + (?::int * interval '1 millisecond'),
           "attempts" = "attempts" + 1,
           "started_at" = now()
       where "id" = (
         select "id" from "scrape_job"
         where ("state" = 'queued' and "run_at" <= now())
            or ("state" = 'running' and "leased_until" < now())
         order by "requested_at" asc
         for update skip locked
         limit 1
       )
       returning "id", "dedupe_key", "subreddit", "attempts", "lease_owner", "leased_until"`,
      [workerId, leaseMs],
    );
    return rows.length > 0 ? toJob(rows[0]) : null;
  }

  async renew(
    id: string,
    workerId: string,
    leaseMs: number = DEFAULT_SCRAPE_LEASE_MS,
  ): Promise<boolean> {
    const rows = await this.em.execute<Array<{ id: string }>>(
      `update "scrape_job"
         set "leased_until" = now() + (?::int * interval '1 millisecond')
         where "id" = ? and "lease_owner" = ? and "state" = 'running'
           and "leased_until" > now()
         returning "id"`,
      [leaseMs, id, workerId],
    );
    return rows.length > 0;
  }

  async complete(id: string, workerId: string): Promise<boolean> {
    const rows = await this.em.execute<Array<{ id: string }>>(
      `update "scrape_job"
         set "state" = 'done', "finished_at" = now(), "lease_owner" = null, "leased_until" = null
         where "id" = ? and "lease_owner" = ? and "state" = 'running'
           and "leased_until" > now()
         returning "id"`,
      [id, workerId],
    );
    return rows.length > 0;
  }

  async fail(
    id: string,
    workerId: string,
    error: string,
    maxAttempts: number = DEFAULT_SCRAPE_MAX_ATTEMPTS,
  ): Promise<ScrapeFailureResult | null> {
    const rows = await this.em.execute<
      Array<{ state: 'queued' | 'failed'; run_at: Date | string }>
    >(
      `update "scrape_job"
         set "state" = case when "attempts" >= ? then 'failed' else 'queued' end,
             "last_error" = ?,
             "lease_owner" = null,
             "leased_until" = null,
             "finished_at" = case when "attempts" >= ? then now() else null end,
             "run_at" = case when "attempts" >= ? then "run_at"
                             else now() + (power(2, least("attempts", 5)) * interval '1 minute') end
         where "id" = ? and "lease_owner" = ? and "state" = 'running'
         returning "state", "run_at"`,
      [maxAttempts, error, maxAttempts, maxAttempts, id, workerId],
    );
    return rows.length > 0
      ? { state: rows[0].state, runAt: new Date(rows[0].run_at) }
      : null;
  }
}
