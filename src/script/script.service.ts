import { Injectable } from '@nestjs/common';
import { LlmService } from './llm-service';
import { ScriptContract } from '../domain/contracts';
import { PostData, CommentData } from '../domain/types/post.types';
import { createServiceLogger } from '../infrastructure/logging/logging.module';

@Injectable()
export class ScriptService implements ScriptContract {
  private readonly logger = createServiceLogger(ScriptService.name);

  constructor(private readonly llmService: LlmService) {}

  private collectChain(
    c: CommentData,
    repliesMap: Map<string, CommentData[]>,
    chainList: CommentData[],
  ): number {
    chainList.push(c);
    const words = c.body.split(/\s+/).filter(Boolean).length;
    let totalWords = words;
    const replies = repliesMap.get(c.redditId) || [];
    for (const reply of replies) {
      totalWords += this.collectChain(reply, repliesMap, chainList);
    }
    return totalWords;
  }

  async generateScript(
    posts: PostData[],
    comments: CommentData[],
  ): Promise<string> {
    const systemPrompt = `You are a professional script writer for a call-in talk radio show called "Social Radio". 
Your job is to write a highly engaging, natural-sounding dialogue script for a segment.
Format of the segment:
1. Introduction: The co-hosts (a team of 4 co-hosts: Dave, Sarah, Mike, and Jenny) welcome the listeners and introduce a guest caller.
2. The Caller: The Guest Caller (referred to simply as "Caller") explains their situation based on the Post Title and Body.
3. The Debate: The co-hosts (Dave, Sarah, Mike, and Jenny) discuss, debate, and give advice. They must use the provided public stances (Comments list) as inspiration for their opinions and banter. They should adopt these stances as their own arguments rather than reading them out as quotes.
4. Outro: The hosts wrap up the call and say goodbye to the caller.

Write a detailed dialogue script of approximately 1,500 to 2,000 words so that the spoken radio segment lasts between 10 and 15 minutes.
Format each line exactly as:
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
        const repliesMap = new Map<string, CommentData[]>();
        const topLevel: CommentData[] = [];

        for (const c of postComments) {
          if (!c.parentRedditId) {
            topLevel.push(c);
          } else {
            const list = repliesMap.get(c.parentRedditId) || [];
            list.push(c);
            repliesMap.set(c.parentRedditId, list);
          }
        }

        // Calculate base word count for the post
        const postBaseWords = (post.title + ' ' + (post.body || ''))
          .split(/\s+/)
          .filter(Boolean).length;
        let currentWordCount = postBaseWords;
        const selectedComments: CommentData[] = [];

        // Sort top-level comments by score descending
        const sortedTopLevel = [...topLevel].sort((a, b) => b.score - a.score);

        for (const topComment of sortedTopLevel) {
          if (currentWordCount >= 2500) {
            break;
          }
          const chainList: CommentData[] = [];
          const chainWords = this.collectChain(
            topComment,
            repliesMap,
            chainList,
          );

          // Hard ceiling cutoff guard: do not exceed 3500 total words
          if (currentWordCount + chainWords > 3500) {
            break;
          }

          selectedComments.push(...chainList);
          currentWordCount += chainWords;
        }

        const selectedIds = new Set(selectedComments.map((c) => c.id));
        const filteredTopLevel = sortedTopLevel.filter((c) =>
          selectedIds.has(c.id),
        );

        const renderThread = (c: CommentData, depth: number) => {
          const indent = '  '.repeat(depth);
          const label = c.isOp ? '[Caller Reply]' : '[Public Stance]';
          userPrompt += `${indent}- ${label}: "${c.body}" (Score: ${c.score})\n`;

          const replies = repliesMap.get(c.redditId) || [];
          const filteredReplies = replies.filter((reply) =>
            selectedIds.has(reply.id),
          );
          filteredReplies.sort((a, b) => b.score - a.score);

          for (const reply of filteredReplies) {
            renderThread(reply, depth + 1);
          }
        };

        for (const c of filteredTopLevel) {
          renderThread(c, 0);
        }
      }
      userPrompt += `\n`;
    }

    userPrompt += `Please write the complete spoken dialogue script now.`;

    const startMs = Date.now();
    const script = await this.llmService.generateText(systemPrompt, userPrompt);
    // LLM calls are the slowest + most expensive step in the chain — size
    // and latency are the ops signal for cost and time-to-queue.
    this.logger.info(
      {
        posts: posts.length,
        comments: comments.length,
        inputWords: userPrompt.split(/\s+/).filter(Boolean).length,
        outputWords: script.split(/\s+/).filter(Boolean).length,
        ms: Date.now() - startMs,
      },
      'LLM script generation',
    );
    return script;
  }
}
