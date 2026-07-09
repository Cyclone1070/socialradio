import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { Post } from './entities/post.entity';
import { Comment } from './entities/comment.entity';
import { RedditApiService } from './reddit-api.service';
import { ScraperService } from './scraper.service';
import { DomainModule } from '../domain/domain.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Post, Comment]),
    HttpModule,
    DomainModule,
  ],
  providers: [RedditApiService, ScraperService],
  exports: [ScraperService, TypeOrmModule],
})
export class FeedModule {}
