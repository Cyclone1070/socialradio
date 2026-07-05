import { FeedItem } from '../types/feed-item.type';

export interface FeedProvider {
  /**
   * Fetches content from a specific source.
   * @param sourceIdentifier The target subreddit, feed url, or account handle.
   * @param limit Maximum number of feed items to retrieve (default: 5).
   */
  fetchFeed(sourceIdentifier: string, limit?: number): Promise<FeedItem[]>;
}
