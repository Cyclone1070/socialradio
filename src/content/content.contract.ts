import { PostData, CommentData } from './types/post.types';
import { SubredditData } from './types/subreddit.types';

/**
 * What content offers the rest of the app: read stored posts, comments and
 * subreddits, and ask for a scrape.
 *
 * It lives here rather than in a shared folder because this slice is the one
 * that implements it. A caller imports this file and the package edge is
 * `channel -> content`, visible in the declared edge list.
 */
export abstract class ContentContract {
  abstract getPostData(postId: string): Promise<PostData | null>;
  abstract getPostsBySubredditIds(subredditIds: string[]): Promise<PostData[]>;
  abstract getCommentsByPostIds(postIds: string[]): Promise<CommentData[]>;
  abstract getSubredditsByIds(ids: string[]): Promise<SubredditData[]>;
  abstract getSubredditByName(name: string): Promise<SubredditData | null>;
  abstract scrapeSubreddit(subredditName: string): Promise<void>;
}
