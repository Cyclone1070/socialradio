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
