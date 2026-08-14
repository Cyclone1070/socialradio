import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createServiceLogger } from '../infrastructure/logging/logging.module';

// Public data shapes produced by the reddit-fetcher container (mirrors
// `reddit-fetcher/src/types.ts` — identity/UA/cookies live there now).
export interface RedditPostData {
  id: string;
  title: string;
  selftext?: string;
  author: string;
  score: number;
  created_utc: number;
}

export interface RedditCommentData {
  id: string;
  body: string;
  author: string;
  score: number;
  parent_id: string;
  created_utc: number;
}

/**
 * Thin HTTP client for the reddit-fetcher container. All browser-driven
 * scraping (playwright/stealth/fingerprints), per-subreddit contexts and the
 * global 1–2s pacing live in that container — this service only forwards
 * requests over REST.
 */
@Injectable()
export class RedditScraperService {
  private readonly logger = createServiceLogger(RedditScraperService.name);

  constructor(private readonly configService: ConfigService) {}

  private get baseUrl(): string {
    const url = this.configService.get<string>('REDDIT_FETCHER_URL');
    if (!url) {
      throw new Error('REDDIT_FETCHER_URL is not configured');
    }
    return url;
  }

  private async getJson(path: string): Promise<unknown> {
    const startMs = Date.now();
    const res = await fetch(`${this.baseUrl}${path}`);
    const ms = Date.now() - startMs;
    if (!res.ok) {
      // The walk converts this into a quiet stop; the warn is how ops sees
      // the fetcher's health (rate limiting, browserless trouble, …).
      this.logger.warn(
        { path, status: res.status, ms },
        'reddit-fetcher non-ok response',
      );
      throw new Error(`reddit-fetcher ${path} failed: ${res.status}`);
    }
    this.logger.debug(
      { path, status: res.status, ms },
      'reddit-fetcher round trip',
    );
    return res.json();
  }

  async fetchTopPosts(
    subredditName: string,
    opts: { limit?: number; after?: string } = {},
  ): Promise<{
    posts: RedditPostData[];
    after: string | null;
    isInvalid: boolean;
  }> {
    const limit = opts.limit ?? 100;
    const query = `limit=${limit}${opts.after ? `&after=${opts.after}` : ''}`;
    const body = await this.getJson(`/top-posts/${subredditName}?${query}`);
    return body as {
      posts: RedditPostData[];
      after: string | null;
      isInvalid: boolean;
    };
  }

  async exists(subredditName: string): Promise<boolean> {
    try {
      const body = await this.getJson(`/exists/${subredditName}`);
      const { valid } = body as { valid: boolean };
      return valid;
    } catch (err) {
      this.logger.warn(
        {
          subredditName,
          err: err instanceof Error ? err : new Error(String(err)),
        },
        'exists fetch failed',
      );
      return false;
    }
  }

  async fetchPostComments(
    subredditName: string,
    postRedditId: string,
  ): Promise<RedditCommentData[]> {
    const body = await this.getJson(
      `/comments/${subredditName}/${postRedditId}`,
    );
    const { comments } = body as { comments: RedditCommentData[] };
    return comments;
  }
}
