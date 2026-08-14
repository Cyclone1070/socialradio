import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { Subreddit } from './entities/subreddit.entity';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';
import { RedditScraperService } from './reddit-scraper.service';
import { ScraperService } from './scraper.service';
import { ContentService } from './content.service';
import { ContentController } from './content.controller';
import { UserModule } from '../user/user.module';
import { ContentContract } from '../domain/contracts';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subreddit, Post, Comment]),
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
    TypeOrmModule,
  ],
})
export class ContentModule {}
