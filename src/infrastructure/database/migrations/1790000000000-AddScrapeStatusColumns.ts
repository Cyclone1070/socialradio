import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScrapeStatusColumns1790000000000 implements MigrationInterface {
  name = 'AddScrapeStatusColumns1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subreddit" ADD "scrapeStartedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "subreddit" ADD "scrapeCooldownUntil" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subreddit" DROP COLUMN "scrapeCooldownUntil"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subreddit" DROP COLUMN "scrapeStartedAt"`,
    );
  }
}
