import {
  commentsResponseSchema,
  existsResponseSchema,
  parseFetcherPayload,
  RedditFetcherContractError,
  topPostsResponseSchema,
} from './dto/reddit-fetcher.dto';
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

  /**
   * A page fetch takes about 4-9 seconds against reddit, measured. Node's own http
   * client would only give up after five minutes of silence, and any byte resets
   * that clock, so a browser job that hangs can hold the scrape claim - and every
   * other instance standing aside - for the length of the walk. This is our own
   * ceiling instead, generous enough that a cold browser under load still fits.
   */
  private get deadlineMs(): number {
    const raw = this.configService.get<string>('REDDIT_FETCHER_TIMEOUT_MS');
    const parsed = raw ? parseFloat(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 60000;
  }

  private async getJson(path: string): Promise<unknown> {
    const startMs = Date.now();
    const deadlineMs = this.deadlineMs;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        signal: AbortSignal.timeout(deadlineMs),
      });
    } catch (err: unknown) {
      // Matched by name rather than by class: the abort carries whichever realm
      // created the signal, and under jest that is not this one, so
      // `instanceof Error` is not a reliable gate here.
      const name = (err as { name?: unknown } | null | undefined)?.name;
      if (name === 'TimeoutError') {
        this.logger.warn(
          { path, ms: Date.now() - startMs, deadlineMs },
          'reddit-fetcher call exceeded its deadline',
        );
        throw new Error(
          `reddit-fetcher ${path} exceeded its ${deadlineMs}ms deadline`,
        );
      }
      throw err;
    }
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
    return parseFetcherPayload(
      topPostsResponseSchema,
      body,
      `/top-posts/${subredditName}`,
    );
  }

  async exists(subredditName: string): Promise<boolean> {
    try {
      const body = await this.getJson(`/exists/${subredditName}`);
      const { valid } = parseFetcherPayload(
        existsResponseSchema,
        body,
        `/exists/${subredditName}`,
      );
      return valid;
    } catch (err) {
      // A malformed payload must not read as "this subreddit is gone": callers
      // delete rows on a false answer.
      if (err instanceof RedditFetcherContractError) {
        throw err;
      }
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
    const { comments } = parseFetcherPayload(
      commentsResponseSchema,
      body,
      `/comments/${subredditName}/${postRedditId}`,
    );
    return comments;
  }
}
