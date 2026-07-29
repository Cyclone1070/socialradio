import { MigrationInterface, QueryRunner } from 'typeorm';
import * as bcrypt from 'bcrypt';

interface IdRecord {
  id: string;
}

export class InitialSeed1700000000000 implements MigrationInterface {
  name = 'InitialSeed1700000000000';
  timestamp = 1700000000000;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@socialradio.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'AdminPass123!';

    // 0. Ensure Database Tables Exist (DDL - separate calls per table)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" varchar NOT NULL UNIQUE,
        "passwordHash" varchar NOT NULL,
        "role" varchar NOT NULL DEFAULT 'user',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "subreddit" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar NOT NULL UNIQUE,
        "lastScrapedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "jingle" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "filePath" varchar NOT NULL,
        "durationSeconds" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "music_track" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "title" varchar NOT NULL,
        "artist" varchar NOT NULL,
        "filePath" varchar NOT NULL,
        "durationSeconds" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "channel" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar NOT NULL UNIQUE,
        "ownerId" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "channel_subreddit" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "channelId" uuid NOT NULL REFERENCES "channel"("id") ON DELETE CASCADE,
        "subredditId" uuid NOT NULL REFERENCES "subreddit"("id") ON DELETE CASCADE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_channel_subreddit" UNIQUE ("channelId", "subredditId")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "post" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "redditId" varchar NOT NULL UNIQUE,
        "subredditId" uuid NOT NULL REFERENCES "subreddit"("id") ON DELETE CASCADE,
        "title" varchar NOT NULL,
        "author" varchar NOT NULL,
        "score" integer NOT NULL DEFAULT 0,
        "numComments" integer NOT NULL DEFAULT 0,
        "selftext" text NOT NULL DEFAULT '',
        "url" varchar NOT NULL DEFAULT '',
        "permalink" varchar NOT NULL DEFAULT '',
        "scrapedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "comment" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "redditId" varchar NOT NULL UNIQUE,
        "postId" uuid NOT NULL REFERENCES "post"("id") ON DELETE CASCADE,
        "author" varchar NOT NULL,
        "body" text NOT NULL,
        "score" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "segment" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "channelId" uuid NOT NULL REFERENCES "channel"("id") ON DELETE CASCADE,
        "type" varchar NOT NULL,
        "durationSeconds" integer NOT NULL,
        "audioPath" varchar,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "channel_post_progress" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "channelId" uuid NOT NULL REFERENCES "channel"("id") ON DELETE CASCADE,
        "postId" uuid NOT NULL REFERENCES "post"("id") ON DELETE CASCADE,
        "status" varchar NOT NULL DEFAULT 'pending',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_channel_post" UNIQUE ("channelId", "postId")
      )
    `);

    // 1. Seed Admin User (DML)
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    await queryRunner.query(
      `INSERT INTO "user" ("email", "passwordHash", "role") 
       VALUES ($1, $2, 'admin') 
       ON CONFLICT ("email") DO NOTHING;`,
      [adminEmail, passwordHash],
    );

    // 2. Seed Default Subreddits
    await queryRunner.query(
      `INSERT INTO "subreddit" ("name") VALUES ('AskReddit'), ('technology'), ('todayilearned') 
       ON CONFLICT ("name") DO NOTHING;`,
    );

    // 3. Seed Starter Media Assets
    await queryRunner.query(
      `INSERT INTO "jingle" ("filePath", "durationSeconds") 
       VALUES ('media/jingles/station_id_01.mp3', 5) 
       ON CONFLICT DO NOTHING;`,
    );

    await queryRunner.query(
      `INSERT INTO "music_track" ("title", "artist", "filePath", "durationSeconds") 
       VALUES ('Synthwave Midnight Drive', 'Social Radio Records', 'media/music/synthwave_drive.mp3', 180) 
       ON CONFLICT DO NOTHING;`,
    );

    // 4. Seed Starter Channel
    const adminUser = (await queryRunner.query(
      `SELECT "id" FROM "user" WHERE "email" = $1 LIMIT 1;`,
      [adminEmail],
    )) as IdRecord[];
    const adminId = adminUser[0]?.id;

    if (adminId) {
      await queryRunner.query(
        `INSERT INTO "channel" ("name", "ownerId") 
         VALUES ('Tech & Trivia 24/7', $1) 
         ON CONFLICT ("name") DO NOTHING;`,
        [adminId],
      );

      const channel = (await queryRunner.query(
        `SELECT "id" FROM "channel" WHERE "name" = 'Tech & Trivia 24/7' LIMIT 1;`,
      )) as IdRecord[];
      const channelId = channel[0]?.id;

      if (channelId) {
        await queryRunner.query(
          `INSERT INTO "channel_subreddit" ("channelId", "subredditId")
           SELECT $1, "id" FROM "subreddit" WHERE "name" IN ('AskReddit', 'technology', 'todayilearned')
           ON CONFLICT DO NOTHING;`,
          [channelId],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "channel_post_progress" CASCADE;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "segment" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "comment" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "post" CASCADE;`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "channel_subreddit" CASCADE;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "channel" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "music_track" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "jingle" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subreddit" CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user" CASCADE;`);
  }
}
