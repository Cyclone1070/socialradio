import { Migration } from '@mikro-orm/migrations';

export class Migration20260914173000 extends Migration {
  override async up(): Promise<void> {
    // 1. Clean up any existing null or invalid segment data before locking down
    this.addSql(
      `UPDATE "segment" SET "duration_seconds" = 10 WHERE "duration_seconds" IS NULL OR "duration_seconds" <= 0;`,
    );
    this.addSql(
      `UPDATE "segment" SET "audio_url" = 'jingles/station-id.mp3' WHERE "audio_url" IS NULL;`,
    );

    // 2. Lock down segment table
    this.addSql(
      `ALTER TABLE "segment" ALTER COLUMN "audio_url" SET NOT NULL;`,
    );
    this.addSql(
      `ALTER TABLE "segment" ALTER COLUMN "duration_seconds" SET NOT NULL;`,
    );
    this.addSql(
      `ALTER TABLE "segment" ADD CONSTRAINT "segment_duration_positive" CHECK ("duration_seconds" > 0);`,
    );
    this.addSql(
      `ALTER TABLE "segment" ADD CONSTRAINT "segment_type_check" CHECK ("type" IN ('music', 'talk', 'ad', 'jingle'));`,
    );

    // 3. Lock down media tracks duration
    this.addSql(
      `ALTER TABLE "music_track" ADD CONSTRAINT "music_track_duration_positive" CHECK ("duration_seconds" > 0);`,
    );
    this.addSql(
      `ALTER TABLE "ad_track" ADD CONSTRAINT "ad_track_duration_positive" CHECK ("duration_seconds" > 0);`,
    );
    this.addSql(
      `ALTER TABLE "jingle" ADD CONSTRAINT "jingle_duration_positive" CHECK ("duration_seconds" > 0);`,
    );

    // 4. Lock down channel table
    this.addSql(
      `ALTER TABLE "channel" ADD CONSTRAINT "channel_play_order_positive" CHECK ("current_play_order" IS NULL OR "current_play_order" >= 1);`,
    );
    this.addSql(
      `ALTER TABLE "channel" ADD CONSTRAINT "channel_visibility_check" CHECK ("visibility" IN ('public', 'private'));`,
    );

    // 5. Lock down user table
    this.addSql(
      `ALTER TABLE "user" ADD CONSTRAINT "user_role_check" CHECK ("role" IN ('user', 'admin'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "user_role_check";`,
    );
    this.addSql(
      `ALTER TABLE "channel" DROP CONSTRAINT IF EXISTS "channel_visibility_check";`,
    );
    this.addSql(
      `ALTER TABLE "channel" DROP CONSTRAINT IF EXISTS "channel_play_order_positive";`,
    );
    this.addSql(
      `ALTER TABLE "jingle" DROP CONSTRAINT IF EXISTS "jingle_duration_positive";`,
    );
    this.addSql(
      `ALTER TABLE "ad_track" DROP CONSTRAINT IF EXISTS "ad_track_duration_positive";`,
    );
    this.addSql(
      `ALTER TABLE "music_track" DROP CONSTRAINT IF EXISTS "music_track_duration_positive";`,
    );
    this.addSql(
      `ALTER TABLE "segment" DROP CONSTRAINT IF EXISTS "segment_type_check";`,
    );
    this.addSql(
      `ALTER TABLE "segment" DROP CONSTRAINT IF EXISTS "segment_duration_positive";`,
    );
    this.addSql(
      `ALTER TABLE "segment" ALTER COLUMN "duration_seconds" DROP NOT NULL;`,
    );
    this.addSql(
      `ALTER TABLE "segment" ALTER COLUMN "audio_url" DROP NOT NULL;`,
    );
  }
}
