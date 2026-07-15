import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { PassportModule } from '@nestjs/passport';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';
import { RedditApiService } from './reddit-api.service';
import { ScraperService } from './scraper.service';
import { FeedController } from './feed.controller';
import { DomainModule } from '../domain/domain.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Post, Comment]),
    HttpModule,
    DomainModule,
    PassportModule,
  ],
  controllers: [FeedController],
  providers: [RedditApiService, ScraperService],
  exports: [ScraperService, RedditApiService, TypeOrmModule],
})
export class FeedModule {}
