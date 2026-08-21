import { Migration } from '@mikro-orm/migrations';

export class Migration20260820115947 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "ad_track" ("id" uuid not null default gen_random_uuid(), "advertiser" varchar(255) not null, "file_path" varchar(255) not null, "duration_seconds" real not null, "created_at" timestamptz not null default now(), constraint "ad_track_pkey" primary key ("id"));`,
    );

    this.addSql(
      `create table "channel" ("id" uuid not null default gen_random_uuid(), "name" varchar(255) not null, "visibility" varchar(255) not null default 'public', "owner_id" varchar(255) null, "current_segment_id" varchar(255) null, "created_at" timestamptz not null default now(), constraint "channel_pkey" primary key ("id"));`,
    );

    this.addSql(
      `create table "jingle" ("id" uuid not null default gen_random_uuid(), "name" varchar(255) not null, "file_path" varchar(255) not null, "duration_seconds" real not null, "created_at" timestamptz not null default now(), constraint "jingle_pkey" primary key ("id"));`,
    );

    this.addSql(
      `create table "music_track" ("id" uuid not null default gen_random_uuid(), "title" varchar(255) not null, "artist" varchar(255) not null, "file_path" varchar(255) not null, "duration_seconds" real not null, "created_at" timestamptz not null default now(), constraint "music_track_pkey" primary key ("id"));`,
    );

    this.addSql(
      `create table "segment" ("id" uuid not null default gen_random_uuid(), "channelId" uuid not null, "play_order" int not null, "audio_url" varchar(255) null, "duration_seconds" real null, "type" varchar(255) not null, "created_at" timestamptz not null default now(), "title" varchar(255) null, "artist" varchar(255) null, "cluster_id" varchar(255) null, "status" varchar(255) null default 'generating', "script" jsonb null, constraint "segment_pkey" primary key ("id"));`,
    );
    this.addSql(`create index "segment_type_index" on "segment" ("type");`);
    this.addSql(
      `create index "segment_channelId_index" on "segment" ("channelId");`,
    );
    this.addSql(
      `create index "segment_channelId_play_order_index" on "segment" ("channelId", "play_order");`,
    );

    this.addSql(
      `create table "subreddit" ("id" uuid not null default gen_random_uuid(), "name" varchar(255) not null, "last_scraped_at" timestamptz null, "scrape_started_at" timestamptz null, "scrape_cooldown_until" timestamptz null, "created_at" timestamptz not null default now(), constraint "subreddit_pkey" primary key ("id"));`,
    );
    this.addSql(
      `alter table "subreddit" add constraint "subreddit_name_unique" unique ("name");`,
    );

    this.addSql(
      `create table "post" ("id" uuid not null default gen_random_uuid(), "subredditId" uuid not null, "reddit_id" varchar(255) not null, "title" varchar(255) not null, "body" text not null, "score" int not null, "reddit_created_at" timestamptz not null, "scraped_at" timestamptz not null default now(), constraint "post_pkey" primary key ("id"));`,
    );
    this.addSql(
      `alter table "post" add constraint "post_reddit_id_unique" unique ("reddit_id");`,
    );
    this.addSql(
      `create index "post_subredditId_index" on "post" ("subredditId");`,
    );
    this.addSql(
      `create index "post_scraped_at_index" on "post" ("scraped_at");`,
    );

    this.addSql(
      `create table "comment" ("id" uuid not null default gen_random_uuid(), "postId" uuid not null, "reddit_id" varchar(255) not null, "body" text not null, "score" int not null, "parent_reddit_id" varchar(255) null, "is_op" boolean not null default false, "reddit_created_at" timestamptz not null, constraint "comment_pkey" primary key ("id"));`,
    );
    this.addSql(
      `alter table "comment" add constraint "comment_reddit_id_unique" unique ("reddit_id");`,
    );
    this.addSql(`create index "comment_postId_index" on "comment" ("postId");`);

    this.addSql(
      `create table "channel_post_progress" ("channelId" uuid not null, "postId" uuid not null, constraint "channel_post_progress_pkey" primary key ("channelId", "postId"));`,
    );

    this.addSql(
      `create table "channel_subreddit" ("channelId" uuid not null, "subredditId" uuid not null, constraint "channel_subreddit_pkey" primary key ("channelId", "subredditId"));`,
    );

    this.addSql(
      `create table "user" ("id" uuid not null default gen_random_uuid(), "email" varchar(255) not null, "password_hash" varchar(255) not null, "role" varchar(255) not null default 'user', "created_at" timestamptz not null default now(), constraint "user_pkey" primary key ("id"));`,
    );
    this.addSql(
      `alter table "user" add constraint "user_email_unique" unique ("email");`,
    );

    this.addSql(
      `alter table "segment" add constraint "segment_channelId_foreign" foreign key ("channelId") references "channel" ("id") on update cascade on delete cascade;`,
    );

    this.addSql(
      `alter table "post" add constraint "post_subredditId_foreign" foreign key ("subredditId") references "subreddit" ("id") on update cascade on delete cascade;`,
    );

    this.addSql(
      `alter table "comment" add constraint "comment_postId_foreign" foreign key ("postId") references "post" ("id") on update cascade on delete cascade;`,
    );

    this.addSql(
      `alter table "channel_post_progress" add constraint "channel_post_progress_channelId_foreign" foreign key ("channelId") references "channel" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "channel_post_progress" add constraint "channel_post_progress_postId_foreign" foreign key ("postId") references "post" ("id") on update cascade on delete cascade;`,
    );

    this.addSql(
      `alter table "channel_subreddit" add constraint "channel_subreddit_channelId_foreign" foreign key ("channelId") references "channel" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "channel_subreddit" add constraint "channel_subreddit_subredditId_foreign" foreign key ("subredditId") references "subreddit" ("id") on update cascade on delete cascade;`,
    );
  }
}
