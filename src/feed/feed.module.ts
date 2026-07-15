import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PassportModule } from '@nestjs/passport';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';
import { RedditScraperService } from './reddit-scraper.service';
import { ScraperService } from './scraper.service';
import { FeedController } from './feed.controller';
import { DomainModule } from '../domain/domain.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Post, Comment]),
    DomainModule,
    PassportModule,
  ],
  controllers: [FeedController],
  providers: [RedditScraperService, ScraperService],
  exports: [ScraperService, RedditScraperService, TypeOrmModule],
})
export class FeedModule {}
