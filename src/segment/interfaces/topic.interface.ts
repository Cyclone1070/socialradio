import { PostData } from '../../domain';

export interface Topic {
  id: string;
  name: string;
  posts: PostData[];
  score: number;
}
