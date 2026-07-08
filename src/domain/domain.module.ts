import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subreddit } from './entities/subreddit.entity';
import { Topic } from './entities/topic.entity';
import { FilesystemService } from './filesystem.service';

@Module({
  imports: [TypeOrmModule.forFeature([Subreddit, Topic])],
  providers: [FilesystemService],
  exports: [TypeOrmModule, FilesystemService],
})
export class DomainModule {}

