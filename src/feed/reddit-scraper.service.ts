import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
  constructor(private readonly configService: ConfigService) {}

  private get baseUrl(): string {
    const url = this.configService.get<string>('REDDIT_FETCHER_URL');
    if (!url) {
      throw new Error('REDDIT_FETCHER_URL is not configured');
    }
    return url;
  }

  private async getJson(path: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      throw new Error(`reddit-fetcher ${path} failed: ${res.status}`);
    }
    return res.json();
  }

  async fetchTopPosts(
    subredditName: string,
    limit: number,
  ): Promise<{ posts: RedditPostData[]; isInvalid: boolean }> {
    const body = await this.getJson(
      `/top-posts/${subredditName}?limit=${limit}`,
    );
    return body as { posts: RedditPostData[]; isInvalid: boolean };
  }

  async exists(subredditName: string): Promise<boolean> {
    const body = await this.getJson(`/exists/${subredditName}`);
    const { valid } = body as { valid: boolean };
    return valid;
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
