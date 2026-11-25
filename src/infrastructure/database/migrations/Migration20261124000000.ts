import { Migration } from '@mikro-orm/migrations';

export class Migration20261124000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "scrape_job" ("id" uuid not null default gen_random_uuid(), "dedupe_key" varchar(255) not null, "subreddit" varchar(255) not null, "state" varchar(20) not null default 'queued', "attempts" int not null default 0, "requested_at" timestamptz not null default now(), "run_at" timestamptz not null default now(), "leased_until" timestamptz null, "lease_owner" varchar(255) null, "started_at" timestamptz null, "finished_at" timestamptz null, "last_error" text null, "created_at" timestamptz not null default now(), constraint "scrape_job_pkey" primary key ("id"), constraint scrape_job_state_check check (state in ('queued', 'running', 'done', 'failed')));`,
    );
    this.addSql(
      `create unique index "scrape_job_active_dedupe" on "scrape_job" ("dedupe_key") where state in ('queued', 'running');`,
    );
    this.addSql(
      `create index "scrape_job_state_run_at_index" on "scrape_job" ("state", "run_at");`,
    );
    this.addSql(
      `create index "scrape_job_leased_until_index" on "scrape_job" ("leased_until");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "scrape_job" cascade;`);
  }
}
