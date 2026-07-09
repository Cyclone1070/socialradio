import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import {
  RedditApiService,
  RedditPostData,
  RedditCommentData,
} from './reddit-api.service';
import { ConfigService } from '@nestjs/config';

describe('RedditApiService', () => {
  let service: RedditApiService;

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

      await service.authenticate();

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'https://www.reddit.com/api/v1/access_token',
        'grant_type=client_credentials',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Basic Y2xpZW50X2lkOmNsaWVudF9zZWNyZXQ=', // base64 of client_id:client_secret
          }) as unknown,
        }) as unknown,
      );
      expect(service['accessToken']).toBe('mock_token');
    });
  });

  describe('fetchTopPosts', () => {
    it('should fetch top posts from subreddit', async () => {
      // Setup auth state
      service['accessToken'] = 'mock_token';
      service['tokenExpiresAt'] = new Date(Date.now() + 100000);

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
                score: 100,
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

      const result: RedditPostData[] = await service.fetchTopPosts(
        'AskReddit',
        10,
      );

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://oauth.reddit.com/r/AskReddit/top?t=day&limit=10',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock_token',
          }) as unknown,
        }) as unknown,
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('abc123');
    });
  });

  describe('fetchPostComments', () => {
    it('should recursively fetch comments and their replies for a post', async () => {
      service['accessToken'] = 'mock_token';
      service['tokenExpiresAt'] = new Date(Date.now() + 100000);

      // Mock nested comment structure where comment1 has a reply comment2
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
                  body: 'comment body',
                  author: 'commenter1',
                  score: 10,
                  parent_id: 't3_abc123',
                  created_utc: 1719999999,
                  replies: {
                    kind: 'Listing',
                    data: {
                      children: [
                        {
                          kind: 't1',
                          data: {
                            id: 'reply123',
                            body: 'reply body',
                            author: 'commenter2',
                            score: 3,
                            parent_id: 't1_xyz789',
                            created_utc: 1720000000,
                            replies: '', // no replies
                          },
                        },
                      ],
                    },
                  },
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

      const result: RedditCommentData[] = await service.fetchPostComments(
        'AskReddit',
        'abc123',
        20,
      );

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://oauth.reddit.com/r/AskReddit/comments/abc123?sort=top&limit=20',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock_token',
          }) as unknown,
        }) as unknown,
      );
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('xyz789');
      expect(result[1].id).toBe('reply123');
      expect(result[1].parent_id).toBe('t1_xyz789');
      expect(result[1].author).toBe('commenter2');
    });
  });
});
