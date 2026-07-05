export interface FeedComment {
  content: string;
  role: 'op' | 'community';
  score: number;
}

export interface FeedItem {
  id: string;
  title: string;
  content?: string;
  community?: string;
  score: number;
  commentsCount: number;
  comments: FeedComment[];
}
