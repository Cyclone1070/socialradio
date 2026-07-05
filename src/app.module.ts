import { Module } from '@nestjs/common';
import { FeedModule } from './features/feed/feed.module';

@Module({
  imports: [FeedModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
