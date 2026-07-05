import { Injectable } from '@nestjs/common';
import { RedditProvider } from './providers/reddit-provider.service';
import { FeedItem } from './types/feed-item.type';

@Injectable()
export class FeedService {
  constructor(private readonly redditProvider: RedditProvider) {}

  async fetchFeed(
    source: 'reddit',
    identifier: string,
    limit?: number,
  ): Promise<FeedItem[]> {
    if (source === 'reddit') {
      return this.redditProvider.fetchFeed(identifier, limit);
    }

    throw new Error(`Unsupported feed source: ${source as string}`);
  }
}
