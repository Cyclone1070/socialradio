import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { RedditApiService } from './reddit-api.service';
import { ConfigService } from '@nestjs/config';

describe('RedditApiService', () => {
  let service: RedditApiService;
  let http: HttpService;

  const mockHttpService = {
    post: jest.fn(),
    get: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'REDDIT_CLIENT_ID') return 'client_id';
      if (key === 'REDDIT_CLIENT_SECRET') return 'client_secret';
      if (key === 'REDDIT_USER_AGENT') return 'user_agent';
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedditApiService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<RedditApiService>(RedditApiService);
    http = module.get<HttpService>(HttpService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('authenticate', () => {
    it('should successfully get an access token', async () => {
      const responseData = { access_token: 'mock_token', expires_in: 3600 };
      const response: AxiosResponse = {
        data: responseData,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      };

      mockHttpService.post.mockReturnValue(of(response));

      await (service as any).authenticate();

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'https://www.reddit.com/api/v1/access_token',
        'grant_type=client_credentials',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Basic Y2xpZW50X2lkOmNsaWVudF9zZWNyZXQ=', // base64 of client_id:client_secret
          }),
        }),
      );
      expect((service as any).accessToken).toBe('mock_token');
    });
  });

  describe('fetchTopPosts', () => {
    it('should fetch top posts from subreddit', async () => {
      // Setup auth state
      (service as any).accessToken = 'mock_token';
      (service as any).tokenExpiresAt = new Date(Date.now() + 100000);

      const listingData = {
        kind: 'Listing',
        data: {
          children: [
            {
              kind: 't3',
              data: {
                id: 'abc123',
                name: 't3_abc123',
                title: 'Test Post',
                selftext: 'Body of post',
                author: 'author1',
                score: 100,
                num_comments: 50,
                permalink: '/r/AskReddit/comments/abc123/test_post/',
                created_utc: 1719999999,
              },
            },
          ],
          after: null,
        },
      };

      const response: AxiosResponse = {
        data: listingData,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      };

      mockHttpService.get.mockReturnValue(of(response));

      const result = await (service as any).fetchTopPosts('AskReddit', 10);

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://oauth.reddit.com/r/AskReddit/top?t=day&limit=10',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock_token',
          }),
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('abc123');
    });
  });

  describe('fetchPostComments', () => {
    it('should fetch comments for a post', async () => {
      (service as any).accessToken = 'mock_token';
      (service as any).tokenExpiresAt = new Date(Date.now() + 100000);

      const commentData = [
        { kind: 'Listing', data: { children: [] } }, // Post listing
        {
          kind: 'Listing',
          data: {
            children: [
              {
                kind: 't1',
                data: {
                  id: 'xyz789',
                  name: 't1_xyz789',
                  body: 'comment body',
                  author: 'commenter1',
                  score: 10,
                  parent_id: 't3_abc123',
                  created_utc: 1719999999,
                },
              },
            ],
          },
        },
      ];

      const response: AxiosResponse = {
        data: commentData,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      };

      mockHttpService.get.mockReturnValue(of(response));

      const result = await (service as any).fetchPostComments('AskReddit', 'abc123', 20);

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://oauth.reddit.com/r/AskReddit/comments/abc123?sort=top&limit=20&depth=1',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock_token',
          }),
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('xyz789');
    });
  });
});
