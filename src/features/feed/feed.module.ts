import { Module } from '@nestjs/common';
import { FeedService } from './feed.service';
import { RedditProvider } from './providers/reddit-provider.service';

@Module({
  providers: [RedditProvider, FeedService],
  exports: [FeedService],
})
export class FeedModule {}
