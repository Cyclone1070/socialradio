import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';

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

interface RedditAuthResponse {
  access_token: string;
  expires_in?: number;
}

interface RedditPostListingResponse {
  data?: {
    children?: Array<{
      data: RedditPostData;
    }>;
  };
}

export interface RedditCommentNode {
  kind: string;
  data: {
    id: string;
    body?: string;
    author?: string;
    score?: number;
    parent_id: string;
    created_utc?: number;
    replies?:
      | {
          data?: {
            children?: RedditCommentNode[];
          };
        }
      | string;
  };
}

@Injectable()
export class RedditApiService {
  private accessToken: string | null = null;
  private tokenExpiresAt: Date | null = null;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async authenticate(): Promise<void> {
    const clientId = this.configService.get<string>('REDDIT_CLIENT_ID');
    const clientSecret = this.configService.get<string>('REDDIT_CLIENT_SECRET');
    const userAgent = this.configService.get<string>(
      'REDDIT_USER_AGENT',
      'SocialRadio/1.0.0',
    );

    if (!clientId || !clientSecret) {
      throw new Error('Reddit Client ID or Client Secret not configured');
    }

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
      'base64',
    );

    const response = await lastValueFrom(
      this.httpService.post(
        'https://www.reddit.com/api/v1/access_token',
        'grant_type=client_credentials',
        {
          headers: {
            Authorization: `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': userAgent,
          },
        },
      ),
    );

    const data = response.data as RedditAuthResponse;
    this.accessToken = data.access_token;
    const expiresIn = data.expires_in || 3600;
    this.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
  }

  private async ensureAuthenticated(): Promise<string> {
    if (
      !this.accessToken ||
      !this.tokenExpiresAt ||
      this.tokenExpiresAt <= new Date()
    ) {
      await this.authenticate();
    }
    return this.accessToken!;
  }

  async fetchTopPosts(
    subredditName: string,
    limit: number,
  ): Promise<RedditPostData[]> {
    const token = await this.ensureAuthenticated();
    const userAgent = this.configService.get<string>(
      'REDDIT_USER_AGENT',
      'SocialRadio/1.0.0',
    );

    const response = await lastValueFrom(
      this.httpService.get(
        `https://oauth.reddit.com/r/${subredditName}/top?t=day&limit=${limit}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'User-Agent': userAgent,
          },
        },
      ),
    );

    const data = response.data as RedditPostListingResponse;
    return data?.data?.children?.map((child) => child.data) || [];
  }

  async fetchPostComments(
    subredditName: string,
    postRedditId: string,
    limit: number,
  ): Promise<RedditCommentData[]> {
    const token = await this.ensureAuthenticated();
    const userAgent = this.configService.get<string>(
      'REDDIT_USER_AGENT',
      'SocialRadio/1.0.0',
    );

    const response = await lastValueFrom(
      this.httpService.get(
        `https://oauth.reddit.com/r/${subredditName}/comments/${postRedditId}?sort=top&limit=${limit}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'User-Agent': userAgent,
          },
        },
      ),
    );

    const data = response.data as [
      unknown,
      { data?: { children?: RedditCommentNode[] } },
    ];
    const topLevelChildren = data?.[1]?.data?.children || [];
    const results: RedditCommentData[] = [];

    const walk = (nodes: RedditCommentNode[]) => {
      for (const node of nodes) {
        if (node.kind === 't1') {
          results.push({
            id: node.data.id,
            body: node.data.body || '',
            author: node.data.author || '[deleted]',
            score: node.data.score || 0,
            parent_id: node.data.parent_id,
            created_utc: node.data.created_utc || 0,
          });
          const replies = node.data.replies;
          if (
            replies &&
            typeof replies === 'object' &&
            replies.data?.children
          ) {
            walk(replies.data.children);
          }
        }
      }
    };

    walk(topLevelChildren);
    return results;
  }
}
