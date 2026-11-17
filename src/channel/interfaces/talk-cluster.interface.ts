import { PostData } from '../../content/types/post.types';

export interface TalkCluster {
  id: string;
  name: string;
  posts: PostData[];
  score: number;
}
