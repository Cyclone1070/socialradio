import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../infrastructure/database/mikro-orm.config';
import {
  SubredditSchema,
  PostSchema,
  CommentSchema,
} from '../infrastructure/database/schemas/content.schema';
import { RedditScraperService } from './reddit-scraper.service';
import { ScraperService } from './scraper.service';
import { ScrapeQueueService } from './scrape-queue.service';
import { ScrapeWorkerService } from './scrape-worker.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MikroOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const databaseUrl = config.get<string>('DATABASE_URL');
        return {
          ...mikroOrmConfig,
          driver: PostgreSqlDriver,
          clientUrl: databaseUrl || mikroOrmConfig.clientUrl,
        };
      },
      inject: [ConfigService],
    }),
    MikroOrmModule.forFeature([SubredditSchema, PostSchema, CommentSchema]),
  ],
  providers: [
    RedditScraperService,
    ScraperService,
    ScrapeQueueService,
    ScrapeWorkerService,
  ],
})
export class ScrapeWorkerModule {}
