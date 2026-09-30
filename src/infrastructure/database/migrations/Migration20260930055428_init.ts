import { Migration } from '@mikro-orm/migrations';

export class Migration20260930055428_init extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "ad_track" ("id" uuid not null default gen_random_uuid(), "advertiser" varchar(255) not null, "file_path" varchar(255) not null, "duration_seconds" real not null, "created_at" timestamptz not null default now(), constraint "ad_track_pkey" primary key ("id"), constraint ad_track_duration_positive check (duration_seconds > 0));`,
    );
    this.addSql(
      `alter table "ad_track" add constraint "ad_track_file_path_unique" unique ("file_path");`,
    );

    this.addSql(
      `create table "jingle" ("id" uuid not null default gen_random_uuid(), "name" varchar(255) not null, "file_path" varchar(255) not null, "duration_seconds" real not null, "created_at" timestamptz not null default now(), constraint "jingle_pkey" primary key ("id"), constraint jingle_duration_positive check (duration_seconds > 0));`,
    );
    this.addSql(
      `alter table "jingle" add constraint "jingle_file_path_unique" unique ("file_path");`,
    );

    this.addSql(
      `create table "music_track" ("id" uuid not null default gen_random_uuid(), "title" varchar(255) not null, "artist" varchar(255) not null, "file_path" varchar(255) not null, "duration_seconds" real not null, "created_at" timestamptz not null default now(), constraint "music_track_pkey" primary key ("id"), constraint music_track_duration_positive check (duration_seconds > 0));`,
    );
    this.addSql(
      `alter table "music_track" add constraint "music_track_file_path_unique" unique ("file_path");`,
    );

    this.addSql(
      `create table "subreddit" ("id" uuid not null default gen_random_uuid(), "name" varchar(255) not null, "last_scraped_at" timestamptz null, "scrape_started_at" timestamptz null, "scrape_cooldown_until" timestamptz null, "created_at" timestamptz not null default now(), constraint "subreddit_pkey" primary key ("id"), constraint subreddit_name_not_empty check (length(trim(name)) > 0));`,
    );
    this.addSql(
      `alter table "subreddit" add constraint "subreddit_name_unique" unique ("name");`,
    );

    this.addSql(
      `create table "post" ("id" uuid not null default gen_random_uuid(), "subreddit_id" uuid not null, "reddit_id" varchar(255) not null, "title" text not null, "body" text not null, "score" int not null default 0, "reddit_created_at" timestamptz not null, "scraped_at" timestamptz not null default now(), constraint "post_pkey" primary key ("id"));`,
    );
    this.addSql(
      `alter table "post" add constraint "post_reddit_id_unique" unique ("reddit_id");`,
    );
    this.addSql(
      `create index "post_subreddit_id_index" on "post" ("subreddit_id");`,
    );
    this.addSql(
      `create index "post_scraped_at_index" on "post" ("scraped_at");`,
    );

    this.addSql(
      `create table "comment" ("id" uuid not null default gen_random_uuid(), "post_id" uuid not null, "reddit_id" varchar(255) not null, "body" text not null, "score" int not null, "parent_reddit_id" varchar(255) null, "is_op" boolean not null default false, "reddit_created_at" timestamptz not null, constraint "comment_pkey" primary key ("id"));`,
    );
    this.addSql(
      `alter table "comment" add constraint "comment_reddit_id_unique" unique ("reddit_id");`,
    );
    this.addSql(
      `create index "comment_post_id_index" on "comment" ("post_id");`,
    );

    this.addSql(
      `create table "user" ("id" uuid not null default gen_random_uuid(), "email" varchar(255) not null, "password_hash" varchar(255) not null, "role" varchar(255) not null default 'user', "created_at" timestamptz not null default now(), constraint "user_pkey" primary key ("id"), constraint user_role_check check (role in ('user', 'admin')));`,
    );
    this.addSql(
      `alter table "user" add constraint "user_email_unique" unique ("email");`,
    );

    this.addSql(
      `create table "channel" ("id" uuid not null default gen_random_uuid(), "name" varchar(255) not null, "visibility" varchar(255) not null default 'public', "owner_id" uuid null, "current_segment_id" uuid null, "current_play_order" int null, "playhead_started_at" timestamptz null, "last_active_at" timestamptz null, "created_at" timestamptz not null default now(), constraint "channel_pkey" primary key ("id"), constraint channel_name_not_empty check (length(trim(name)) > 0), constraint channel_visibility_check check (visibility in ('public', 'private')), constraint channel_play_order_positive check (current_play_order is null or current_play_order >= 1));`,
    );
    this.addSql(
      `create index "channel_current_segment_id_index" on "channel" ("current_segment_id");`,
    );
    this.addSql(
      `create index "channel_owner_id_index" on "channel" ("owner_id");`,
    );

    this.addSql(
      `create table "segment" ("id" uuid not null default gen_random_uuid(), "channel_id" uuid not null, "play_order" int not null, "audio_url" varchar(255) not null, "duration_seconds" real not null, "type" varchar(255) not null, "created_at" timestamptz not null default now(), "title" varchar(255) null, "artist" varchar(255) null, "cluster_id" varchar(255) null, "status" varchar(255) null default 'generating', "script" jsonb null, constraint "segment_pkey" primary key ("id"), constraint segment_play_order_positive check (play_order >= 1), constraint segment_duration_bounds check (duration_seconds > 0 and duration_seconds <= 7200), constraint segment_type_check check (type in ('music', 'talk', 'ad', 'jingle')), constraint segment_status_check check (status is null or status in ('generating', 'ready', 'failed')), constraint segment_music_subtype_check check (type != 'music' or (title is not null and artist is not null)), constraint segment_talk_subtype_check check (type != 'talk' or (cluster_id is not null)));`,
    );
    this.addSql(`create index "segment_type_index" on "segment" ("type");`);
    this.addSql(
      `create index "segment_channel_id_index" on "segment" ("channel_id");`,
    );
    this.addSql(
      `alter table "segment" add constraint "segment_channel_id_play_order_unique" unique ("channel_id", "play_order");`,
    );

    this.addSql(
      `create table "channel_subreddit" ("channel_id" uuid not null, "subreddit_id" uuid not null, constraint "channel_subreddit_pkey" primary key ("channel_id", "subreddit_id"));`,
    );

    this.addSql(
      `create table "channel_post_progress" ("channel_id" uuid not null, "post_id" uuid not null, constraint "channel_post_progress_pkey" primary key ("channel_id", "post_id"));`,
    );

    this.addSql(
      `alter table "post" add constraint "post_subreddit_id_foreign" foreign key ("subreddit_id") references "subreddit" ("id") on update cascade on delete cascade;`,
    );

    this.addSql(
      `alter table "comment" add constraint "comment_post_id_foreign" foreign key ("post_id") references "post" ("id") on update cascade on delete cascade;`,
    );

    this.addSql(
      `alter table "channel" add constraint "channel_owner_id_foreign" foreign key ("owner_id") references "user" ("id") on update cascade on delete set null;`,
    );
    this.addSql(
      `alter table "channel" add constraint "channel_current_segment_id_foreign" foreign key ("current_segment_id") references "segment" ("id") on update cascade on delete set null deferrable initially deferred;`,
    );

    this.addSql(
      `alter table "segment" add constraint "segment_channel_id_foreign" foreign key ("channel_id") references "channel" ("id") on update cascade on delete cascade;`,
    );

    this.addSql(
      `alter table "channel_subreddit" add constraint "channel_subreddit_channel_id_foreign" foreign key ("channel_id") references "channel" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "channel_subreddit" add constraint "channel_subreddit_subreddit_id_foreign" foreign key ("subreddit_id") references "subreddit" ("id") on update cascade on delete cascade;`,
    );

    this.addSql(
      `alter table "channel_post_progress" add constraint "channel_post_progress_channel_id_foreign" foreign key ("channel_id") references "channel" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "channel_post_progress" add constraint "channel_post_progress_post_id_foreign" foreign key ("post_id") references "post" ("id") on update cascade on delete cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "post" drop constraint "post_subreddit_id_foreign";`,
    );

    this.addSql(
      `alter table "channel_subreddit" drop constraint "channel_subreddit_subreddit_id_foreign";`,
    );

    this.addSql(
      `alter table "comment" drop constraint "comment_post_id_foreign";`,
    );

    this.addSql(
      `alter table "channel_post_progress" drop constraint "channel_post_progress_post_id_foreign";`,
    );

    this.addSql(
      `alter table "channel" drop constraint "channel_owner_id_foreign";`,
    );

    this.addSql(
      `alter table "segment" drop constraint "segment_channel_id_foreign";`,
    );

    this.addSql(
      `alter table "channel_subreddit" drop constraint "channel_subreddit_channel_id_foreign";`,
    );

    this.addSql(
      `alter table "channel_post_progress" drop constraint "channel_post_progress_channel_id_foreign";`,
    );

    this.addSql(
      `alter table "channel" drop constraint "channel_current_segment_id_foreign";`,
    );

    this.addSql(`drop table if exists "ad_track" cascade;`);

    this.addSql(`drop table if exists "jingle" cascade;`);

    this.addSql(`drop table if exists "music_track" cascade;`);

    this.addSql(`drop table if exists "subreddit" cascade;`);

    this.addSql(`drop table if exists "post" cascade;`);

    this.addSql(`drop table if exists "comment" cascade;`);

    this.addSql(`drop table if exists "user" cascade;`);

    this.addSql(`drop table if exists "channel" cascade;`);

    this.addSql(`drop table if exists "segment" cascade;`);

    this.addSql(`drop table if exists "channel_subreddit" cascade;`);

    this.addSql(`drop table if exists "channel_post_progress" cascade;`);
  }
}
