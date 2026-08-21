import { Collection } from '@mikro-orm/core';

export interface SubredditRef {
  id: string;
  name: string;
}

export interface PostRef {
  id: string;
}

export class Channel {
  id!: string;
  name!: string;
  visibility: 'public' | 'private' = 'public';
  ownerId: string | null = null;
  currentSegmentId: string | null = null;
  subreddits = new Collection<SubredditRef>(this);
  completedPosts = new Collection<PostRef>(this);
  createdAt: Date = new Date();
}
