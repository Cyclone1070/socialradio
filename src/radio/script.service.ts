import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { Post } from '../feed/entities/post.entity';
import { Comment } from '../feed/entities/comment.entity';

@Injectable()
export class ScriptService {
  constructor(private readonly llmService: LlmService) {}

  async generateScript(posts: Post[], comments: Comment[]): Promise<string> {
    const systemPrompt = `You are a professional script writer for a call-in talk radio show called "Social Radio". 
Your job is to write a highly engaging, natural-sounding dialogue script for a segment.
Format of the segment:
1. Introduction: The co-hosts (a team of 4 co-hosts: Dave, Sarah, Mike, and Jenny) welcome the listeners and introduce a guest caller.
2. The Caller: The Guest Caller (referred to simply as "Caller") explains their situation based on the Post Title and Body.
3. The Debate: The co-hosts (Dave, Sarah, Mike, and Jenny) discuss, debate, and give advice. They must use the provided public stances (Comments list) as inspiration for their opinions and banter. They should adopt these stances as their own arguments rather than reading them out as quotes.
4. Outro: The hosts wrap up the call and say goodbye to the caller.

Write the script as spoken dialogue. Format each line exactly as:
[Speaker Name]: Spoken text.
Speakers allowed: Dave, Sarah, Mike, Jenny, Caller.

Deliver it smoothly. Do not mention Reddit terms (like "OP", "upvote", "subreddit"). Avoid markdown bolding, lists, or headers.`;

    let userPrompt = `Here is the topic for the call-in segment:\n\n`;

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      userPrompt += `Title: ${post.title}\n`;
      userPrompt += `Dilemma Details: ${post.body || 'No details provided'}\n`;

      const postComments = comments.filter((c) => c.postId === post.id);
      if (postComments.length > 0) {
        userPrompt += `Public Stances & Arguments (nested threads):\n`;
        const repliesMap = new Map<string, Comment[]>();
        const topLevel: Comment[] = [];

        for (const c of postComments) {
          if (!c.parentRedditId) {
            topLevel.push(c);
          } else {
            const list = repliesMap.get(c.parentRedditId) || [];
            list.push(c);
            repliesMap.set(c.parentRedditId, list);
          }
        }

        const renderThread = (c: Comment, depth: number) => {
          const indent = '  '.repeat(depth);
          const label = c.isOp ? '[Caller Reply]' : '[Public Stance]';
          userPrompt += `${indent}- ${label}: "${c.body}" (Score: ${c.score})\n`;
          const replies = repliesMap.get(c.redditId) || [];
          replies.sort((a, b) => b.score - a.score);
          for (const reply of replies) {
            renderThread(reply, depth + 1);
          }
        };

        topLevel.sort((a, b) => b.score - a.score);
        for (const c of topLevel) {
          renderThread(c, 0);
        }
      }
      userPrompt += `\n`;
    }

    userPrompt += `Please write the complete spoken dialogue script now.`;

    return this.llmService.generateText(systemPrompt, userPrompt);
  }
}
