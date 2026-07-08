import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { Post } from '../feed/entities/post.entity';
import { Comment } from '../feed/entities/comment.entity';

@Injectable()
export class ScriptService {
  constructor(private readonly llmService: LlmService) {}

  async generateScript(posts: Post[], comments: Comment[]): Promise<string> {
    const systemPrompt = `You are a professional radio news anchor for a station called "Social Radio". 
Your job is to read a list of Reddit posts and their top comments, and write a highly engaging, professional, and natural-sounding radio news script (intro, summary, transitions, and outro).
Make it sound exactly like a real radio broadcast segment. Deliver it smoothly. Do not mention Reddit layout terms (like "OP", "upvote", "subreddit"). Write the final script in plain text, suitable for Text-to-Speech (TTS) reading. Avoid special characters, markdown bolding, or lists. Just write paragraphs of spoken narration.`;

    let userPrompt = `Here are the top stories for this segment:\n\n`;

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      userPrompt += `--- STORY ${i + 1} ---\n`;
      userPrompt += `Title: ${post.title}\n`;
      userPrompt += `Author: ${post.author}\n`;
      userPrompt += `Content: ${post.body || 'No selftext body content'}\n`;

      const postComments = comments.filter((c) => c.postId === post.id);
      if (postComments.length > 0) {
        userPrompt += `Top Comments:\n`;
        postComments.forEach((c, idx) => {
          userPrompt += `- Comment ${idx + 1} by ${c.author}: "${c.body}"\n`;
        });
      }
      userPrompt += `\n`;
    }

    userPrompt += `Please write the complete spoken radio script now.`;

    return this.llmService.generateText(systemPrompt, userPrompt);
  }
}
