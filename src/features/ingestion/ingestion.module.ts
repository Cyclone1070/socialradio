import { Module } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { RedditProvider } from './providers/reddit-provider.service';

@Module({
  providers: [RedditProvider, IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
