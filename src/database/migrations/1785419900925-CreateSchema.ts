import { MigrationInterface, QueryRunner } from 'typeorm';
import * as bcrypt from 'bcrypt';

export class CreateSchema1785419900925 implements MigrationInterface {
  name = 'CreateSchema1785419900925';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      throw new Error(
        'InitialSeed migration failed: ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required.',
      );
    }

    await queryRunner.query(
      `CREATE TABLE "channel" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "visibility" character varying NOT NULL DEFAULT 'public', "ownerId" character varying, "currentSegmentId" character varying, "currentSegmentStartedAt" TIMESTAMP, "lastRequestedAt" TIMESTAMP, "playheadOffsetSeconds" double precision NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_590f33ee6ee7d76437acf362e39" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "subreddit" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "lastScrapedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_0a931051f61817575785c8cba68" UNIQUE ("name"), CONSTRAINT "PK_d6f6b72e517b607c8ab94204290" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "comment" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "postId" uuid NOT NULL, "redditId" character varying NOT NULL, "body" text NOT NULL, "score" integer NOT NULL, "parentRedditId" character varying, "isOp" boolean NOT NULL DEFAULT false, "redditCreatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "UQ_8a2cacf1ed01c6ad67feff589c6" UNIQUE ("redditId"), CONSTRAINT "PK_0b0e4bbc8415ec426f87f3a88e2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_94a85bb16d24033a2afdd5df06" ON "comment"  ("postId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "post" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "subredditId" uuid NOT NULL, "redditId" character varying NOT NULL, "title" character varying NOT NULL, "body" text NOT NULL, "score" integer NOT NULL, "redditCreatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "scrapedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_8e9a7162500314db17a684740b7" UNIQUE ("redditId"), CONSTRAINT "PK_be5fda3aac270b134ff9c21cdee" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fd5d1b7cf16b7cc0f8a73b39b3" ON "post"  ("scrapedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3fe214b62d0bb39e69172d0bbb" ON "post"  ("subredditId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "channel_post_progress" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "channelId" uuid NOT NULL, "postId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_966f3befba9dac89eb5ed026f13" UNIQUE ("channelId", "postId"), CONSTRAINT "PK_6c1afe5e2052210764dfad6fba9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e8201a406e6548cfd73492d448" ON "channel_post_progress"  ("channelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "channel_subreddit" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "channelId" uuid NOT NULL, "subredditId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_e8d7e34a859fef6492704a1e1bd" UNIQUE ("channelId", "subredditId"), CONSTRAINT "PK_d02e132321a8b1c1aecda918a01" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_df85d0cdca01b67709600a6edd" ON "channel_subreddit"  ("channelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "segment" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "channelId" uuid NOT NULL, "playOrder" integer NOT NULL, "audioUrl" character varying, "durationSeconds" double precision, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "title" character varying, "artist" character varying, "topicId" character varying, "status" character varying DEFAULT 'generating', "type" character varying NOT NULL, CONSTRAINT "PK_d648ac58d8e0532689dfb8ad7ef" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ac73607576ec1730d660d8eb74" ON "segment"  ("channelId", "playOrder") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_891eca3b0ef6b1e2009d97c3ef" ON "segment"  ("channelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_784fed1223a64e033c4aa6e374" ON "segment"  ("type") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ad_track" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "advertiser" character varying NOT NULL, "filePath" character varying NOT NULL, "durationSeconds" double precision NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_1b46dc94d93901059c2d41f2f39" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "jingle" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "filePath" character varying NOT NULL, "durationSeconds" double precision NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_df1baad329a68fe80fc931c1e3f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "music_track" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying NOT NULL, "artist" character varying NOT NULL, "filePath" character varying NOT NULL, "durationSeconds" double precision NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_9a090fb324070ae864a39e894e6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "topic_audio" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "postId" uuid NOT NULL, "filePath" character varying NOT NULL, "durationSeconds" double precision NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "REL_0912f9b1c31683accdefa2fc40" UNIQUE ("postId"), CONSTRAINT "PK_f54eee21935b37e99e870adaecc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "topic_script" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "postId" uuid NOT NULL, "scriptText" text NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "REL_e5c9ab8db1f6e4642ddd99c3e6" UNIQUE ("postId"), CONSTRAINT "PK_2a49b805cd0c5c648dda1d8fe06" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "user" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "passwordHash" character varying NOT NULL, "role" character varying NOT NULL DEFAULT 'user', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email"), CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "comment" ADD CONSTRAINT "FK_94a85bb16d24033a2afdd5df060" FOREIGN KEY ("postId") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "post" ADD CONSTRAINT "FK_3fe214b62d0bb39e69172d0bbbb" FOREIGN KEY ("subredditId") REFERENCES "subreddit"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_post_progress" ADD CONSTRAINT "FK_e8201a406e6548cfd73492d448c" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_post_progress" ADD CONSTRAINT "FK_4cfdf6405102146972657e1a747" FOREIGN KEY ("postId") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_subreddit" ADD CONSTRAINT "FK_df85d0cdca01b67709600a6edda" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_subreddit" ADD CONSTRAINT "FK_fa50e59c422f5e2a78c856ae91f" FOREIGN KEY ("subredditId") REFERENCES "subreddit"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "segment" ADD CONSTRAINT "FK_891eca3b0ef6b1e2009d97c3ef2" FOREIGN KEY ("channelId") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "topic_audio" ADD CONSTRAINT "FK_0912f9b1c31683accdefa2fc400" FOREIGN KEY ("postId") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "topic_script" ADD CONSTRAINT "FK_e5c9ab8db1f6e4642ddd99c3e62" FOREIGN KEY ("postId") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // Seed Admin User
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    await queryRunner.query(
      `INSERT INTO "user" ("email", "passwordHash", "role")
       VALUES ($1, $2, 'admin')
       ON CONFLICT ("email") DO NOTHING;`,
      [adminEmail, passwordHash],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "topic_script" DROP CONSTRAINT "FK_e5c9ab8db1f6e4642ddd99c3e62"`,
    );
    await queryRunner.query(
      `ALTER TABLE "topic_audio" DROP CONSTRAINT "FK_0912f9b1c31683accdefa2fc400"`,
    );
    await queryRunner.query(
      `ALTER TABLE "segment" DROP CONSTRAINT "FK_891eca3b0ef6b1e2009d97c3ef2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_subreddit" DROP CONSTRAINT "FK_fa50e59c422f5e2a78c856ae91f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_subreddit" DROP CONSTRAINT "FK_df85d0cdca01b67709600a6edda"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_post_progress" DROP CONSTRAINT "FK_4cfdf6405102146972657e1a747"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_post_progress" DROP CONSTRAINT "FK_e8201a406e6548cfd73492d448c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "post" DROP CONSTRAINT "FK_3fe214b62d0bb39e69172d0bbbb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "comment" DROP CONSTRAINT "FK_94a85bb16d24033a2afdd5df060"`,
    );
    await queryRunner.query(`DROP TABLE "user"`);
    await queryRunner.query(`DROP TABLE "topic_script"`);
    await queryRunner.query(`DROP TABLE "topic_audio"`);
    await queryRunner.query(`DROP TABLE "music_track"`);
    await queryRunner.query(`DROP TABLE "jingle"`);
    await queryRunner.query(`DROP TABLE "ad_track"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_784fed1223a64e033c4aa6e374"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_891eca3b0ef6b1e2009d97c3ef"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ac73607576ec1730d660d8eb74"`,
    );
    await queryRunner.query(`DROP TABLE "segment"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_df85d0cdca01b67709600a6edd"`,
    );
    await queryRunner.query(`DROP TABLE "channel_subreddit"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e8201a406e6548cfd73492d448"`,
    );
    await queryRunner.query(`DROP TABLE "channel_post_progress"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3fe214b62d0bb39e69172d0bbb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fd5d1b7cf16b7cc0f8a73b39b3"`,
    );
    await queryRunner.query(`DROP TABLE "post"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_94a85bb16d24033a2afdd5df06"`,
    );
    await queryRunner.query(`DROP TABLE "comment"`);
    await queryRunner.query(`DROP TABLE "subreddit"`);
    await queryRunner.query(`DROP TABLE "channel"`);
  }
}
