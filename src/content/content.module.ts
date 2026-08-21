import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PassportModule } from '@nestjs/passport';
import {
  SubredditSchema,
  PostSchema,
  CommentSchema,
} from '../infrastructure/database/schemas/content.schema';
import { RedditScraperService } from './reddit-scraper.service';
import { ScraperService } from './scraper.service';
import { ContentService } from './content.service';
import { ContentController } from './content.controller';
import { UserModule } from '../user/user.module';
import { ContentContract } from '../domain/contracts';

@Module({
  imports: [
    MikroOrmModule.forFeature([SubredditSchema, PostSchema, CommentSchema]),
    UserModule,
    PassportModule,
  ],
  controllers: [ContentController],
  providers: [
    RedditScraperService,
    ScraperService,
    ContentService,
    {
      provide: ContentContract,
      useClass: ContentService,
    },
  ],
  exports: [
    ScraperService,
    RedditScraperService,
    ContentService,
    ContentContract,
    MikroOrmModule,
  ],
})
export class ContentModule {}
