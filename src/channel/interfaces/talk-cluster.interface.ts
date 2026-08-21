import { PostData } from '../../domain';

export interface TalkCluster {
  id: string;
  name: string;
  posts: PostData[];
  score: number;
}
