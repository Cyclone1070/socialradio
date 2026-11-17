/**
 * The post and comment shapes this slice hands to whoever reads content.
 *
 * They are what callers use, not the rows: the store keeps timestamps and the
 * comment collection, and none of that crosses.
 */
export interface PostData {
  id: string;
  subredditId: string;
  redditId: string;
  title: string;
  body: string;
  score: number;
}

export interface CommentData {
  id: string;
  postId: string;
  redditId: string;
  body: string;
  score: number;
  parentRedditId: string | null;
  isOp: boolean;
}
