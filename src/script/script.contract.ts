import { PostData, CommentData } from '../content/types/post.types';
import { ScriptOutcome } from './types/script.types';

/**
 * Turn a post and its comments into a conversation. The caller supplies the
 * material; this slice decides what the hosts say.
 */
export abstract class ScriptContract {
  abstract generateScript(
    posts: PostData[],
    comments: CommentData[],
    continuityDirective?: string,
  ): Promise<ScriptOutcome>;
}
