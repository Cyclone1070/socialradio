import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';

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
    const userAgent = this.configService.get<string>('REDDIT_USER_AGENT', 'SocialRadio/1.0.0');

    if (!clientId || !clientSecret) {
      throw new Error('Reddit Client ID or Client Secret not configured');
    }

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

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

    this.accessToken = response.data.access_token;
    const expiresIn = response.data.expires_in || 3600;
    this.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
  }

  private async ensureAuthenticated(): Promise<string> {
    if (!this.accessToken || !this.tokenExpiresAt || this.tokenExpiresAt <= new Date()) {
      await this.authenticate();
    }
    return this.accessToken!;
  }

  async fetchTopPosts(subredditName: string, limit: number): Promise<any[]> {
    const token = await this.ensureAuthenticated();
    const userAgent = this.configService.get<string>('REDDIT_USER_AGENT', 'SocialRadio/1.0.0');

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

    return response.data?.data?.children?.map((child: any) => child.data) || [];
  }

  async fetchPostComments(subredditName: string, postRedditId: string, limit: number): Promise<any[]> {
    const token = await this.ensureAuthenticated();
    const userAgent = this.configService.get<string>('REDDIT_USER_AGENT', 'SocialRadio/1.0.0');

    const response = await lastValueFrom(
      this.httpService.get(
        `https://oauth.reddit.com/r/${subredditName}/comments/${postRedditId}?sort=top&limit=${limit}&depth=1`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'User-Agent': userAgent,
          },
        },
      ),
    );

    // Reddit comments API returns an array: [postListing, commentsListing]
    return response.data?.[1]?.data?.children?.map((child: any) => child.data) || [];
  }
}
