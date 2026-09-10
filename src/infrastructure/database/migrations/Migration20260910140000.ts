import { Migration } from '@mikro-orm/migrations';

export class Migration20260910140000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "channel" add column if not exists "playhead_started_at" timestamptz null;`,
    );
    this.addSql(
      `alter table "channel" add column if not exists "last_active_at" timestamptz null;`,
    );
    this.addSql(
      `alter table "channel" add column if not exists "current_play_order" integer null;`,
    );
    this.addSql(
      `alter table "segment" drop constraint if exists "segment_channel_id_play_order_unique";`,
    );
    this.addSql(
      `alter table "segment" add constraint "segment_channel_id_play_order_unique" unique ("channelId", "play_order");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "segment" drop constraint if exists "segment_channel_id_play_order_unique";`,
    );
    this.addSql(
      `alter table "channel" drop column if exists "playhead_started_at";`,
    );
    this.addSql(
      `alter table "channel" drop column if exists "last_active_at";`,
    );
    this.addSql(
      `alter table "channel" drop column if exists "current_play_order";`,
    );
  }
}
