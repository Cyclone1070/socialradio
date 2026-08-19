import { PostData, CommentData } from '../types/post.types';
import { ScriptData } from '../types/script.types';
import { TalkData } from '../types/audio.types';
import { SubredditData } from '../types/subreddit.types';

export abstract class ScriptContract {
  abstract generateScript(
    posts: PostData[],
    comments: CommentData[],
  ): Promise<ScriptData | string>;
}

export abstract class VoiceContract {
  abstract synthesizeScript(
    script: ScriptData,
    outputPath: string,
  ): Promise<TalkData>;
}

export abstract class ContentContract {
  abstract getPostData(postId: string): Promise<PostData | null>;
  abstract getPostsBySubredditIds(subredditIds: string[]): Promise<PostData[]>;
  abstract getCommentsByPostIds(postIds: string[]): Promise<CommentData[]>;
  abstract getSubredditsByIds(ids: string[]): Promise<SubredditData[]>;
  abstract getSubredditByName(name: string): Promise<SubredditData | null>;
  abstract scrapeSubreddit(subredditName: string): Promise<void>;
}
