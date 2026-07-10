import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subreddit } from './entities/subreddit.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Subreddit])],
  providers: [],
  exports: [TypeOrmModule],
})
export class DomainModule {}
