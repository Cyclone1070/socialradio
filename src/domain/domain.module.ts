import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subreddit } from './entities/subreddit.entity';
import { FilesystemService } from './filesystem.service';

@Module({
  imports: [TypeOrmModule.forFeature([Subreddit])],
  providers: [FilesystemService],
  exports: [TypeOrmModule, FilesystemService],
})
export class DomainModule {}
