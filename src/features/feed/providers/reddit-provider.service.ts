import { Injectable } from '@nestjs/common';
import { FeedProvider } from '../interfaces/feed-provider.interface';
import { FeedItem, FeedComment } from '../types/feed-item.type';

interface RedditListingChild {
  data: {
    id: string;
    title: string;
    selftext?: string;
    permalink: string;
    score: number;
    num_comments: number;
  };
}

interface RedditListingResponse {
  data: {
    children: RedditListingChild[];
  };
}

interface RedditCommentChild {
  data: {
    author: string;
    body: string;
    score: number;
    is_submitter: boolean;
  };
}

type RedditDetailResponse = [
  unknown,
  {
    data?: {
      children: RedditCommentChild[];
    };
  },
];

@Injectable()
export class RedditProvider implements FeedProvider {
  async fetchFeed(
    subredditName: string,
    limit: number = 5,
  ): Promise<FeedItem[]> {
    try {
      const response = await fetch(
        `https://www.reddit.com/r/${subredditName}.json?limit=${limit}`,
      );

      if (!response.ok) {
        return [];
      }

      const listingData = (await response.json()) as RedditListingResponse;
      const posts = listingData?.data?.children || [];

      // Run comment detail fetches in parallel to minimize JIT latency
      const feedItems = await Promise.all(
        posts.map(async (post: RedditListingChild) => {
          const postData = post.data;
          if (!postData) return null;

          const detailUrl = `https://www.reddit.com${postData.permalink.replace(/\/$/, '')}.json`;
          let comments: FeedComment[] = [];

          try {
            const detailResponse = await fetch(detailUrl);
            if (detailResponse.ok) {
              const detailData =
                (await detailResponse.json()) as RedditDetailResponse;
              const commentsListing = detailData?.[1]?.data?.children || [];

              comments = commentsListing
                .map((c: RedditCommentChild) => {
                  const commentData = c.data;
                  if (!commentData || !commentData.body) return null;

                  return {
                    content: commentData.body,
                    role: commentData.is_submitter ? 'op' : 'community',
                    score: commentData.score || 0,
                  } as FeedComment;
                })
                .filter(Boolean) as FeedComment[];

              // Sort comments by score descending and take the top 5
              comments.sort((a, b) => b.score - a.score);
              comments = comments.slice(0, 5);
            }
          } catch {
            // Failure on a single post detail shouldn't block the other details
          }

          return {
            id: postData.id,
            title: postData.title,
            content: postData.selftext || undefined,
            community: `r/${subredditName}`,
            score: postData.score || 0,
            commentsCount: postData.num_comments || 0,
            comments,
          } as FeedItem;
        }),
      );

      return feedItems.filter(Boolean) as FeedItem[];
    } catch {
      return [];
    }
  }
}
