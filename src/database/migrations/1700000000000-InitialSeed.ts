import { MigrationInterface, QueryRunner } from 'typeorm';
import * as bcrypt from 'bcrypt';

interface IdRecord {
  id: string;
}

export class InitialSeed1700000000000 implements MigrationInterface {
  name = 'InitialSeed1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      throw new Error(
        'CRITICAL: Missing required environment variables ADMIN_EMAIL and/or ADMIN_PASSWORD. Cannot execute initial seed migration without configured credentials.',
      );
    }

    const passwordHash = await bcrypt.hash(adminPassword, 10);

    // 1. Seed Admin User
    await queryRunner.query(
      `INSERT INTO "user" ("email", "passwordHash") 
       VALUES ($1, $2) 
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
    await queryRunner.query(`DELETE FROM "channel_subreddit";`);
    await queryRunner.query(
      `DELETE FROM "channel" WHERE "name" = 'Tech & Trivia 24/7';`,
    );
    await queryRunner.query(
      `DELETE FROM "music_track" WHERE "title" = 'Synthwave Midnight Drive';`,
    );
    await queryRunner.query(
      `DELETE FROM "jingle" WHERE "filePath" = 'media/jingles/station_id_01.mp3';`,
    );
    await queryRunner.query(
      `DELETE FROM "subreddit" WHERE "name" IN ('AskReddit', 'technology', 'todayilearned');`,
    );
    await queryRunner.query(
      `DELETE FROM "user" WHERE "email" = 'admin@socialradio.com';`,
    );
  }
}
