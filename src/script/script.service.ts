import { Injectable } from '@nestjs/common';
import { LlmService } from './llm.service';
import { ScriptContract } from '../domain/contracts';
import { PostData, CommentData } from '../domain/types/post.types';
import { ScriptData, ScriptTurn } from '../domain/types/script.types';
import { createServiceLogger } from '../infrastructure/logging/logging.module';

export const STAGE1_OUTLINE_SYSTEM_PROMPT = `You are an executive producer for an authentic call-in talk radio show called "Social Radio".
Your job is to read a Reddit post and comment thread, and create a structured 4-step segment outline in standard Markdown for our co-hosts (Dave, Sarah) and a Guest Caller.

=== CO-HOST & CALLER ROLES ===
- Dave (Lead Host): Charismatic anchor with a pragmatic, direct take. Shares bold opinions, banters with Sarah, leads transitions, delivers the verdict, and manages the board.
- Sarah (Co-Host): Quick-witted, empathetic co-host who uncovers emotional nuance, hidden motives, and angles from the comments, matching and riffing with Dave.
- Caller (Guest): Reddit OP, tells their story with authentic dilemma details, answers questions, and actively engages throughout the whole segment.

=== REQUIRED MARKDOWN OUTPUT SCHEMA ===

Output MUST be valid standard Markdown containing these exact headers:

# CALL-IN SEGMENT OUTLINE

## STEP 1: HOST INTRO & HOOK
- Lead-in: [Transition phrase, e.g. "Next up,", "Alright,", "Switching gears,"]
- Hook Angle: [Dramatic summary of the dilemma]
- Caller & Location: [Realistic first name and location matching the geographic/cultural context of the post, e.g. "Alex from Wollongong", "Sarah from Austin", "Mark from Manchester". Infer location from post details or invent a natural plausible city.]
- Line Number: [e.g. "Line 2"]
- Rule: NEVER use generic corporate greetings ("Welcome back", "Today we discuss").
- DYNAMIC ORDER RULE: Specify a unique component delivery order for Dave (e.g. Lead-in -> Hook -> Caller/Loc -> Line, or Lead-in -> Line -> Caller/Loc -> Hook, or Lead-in -> Caller/Loc -> Hook -> Line). Vary the order so no two intros sound identical.

## STEP 2: CALLER NARRATIVE BEATS
- 3 to 4 bullet points outlining how the Caller (OP) explains their story.

## STEP 3: ROOM DYNAMICS & ANGLE EXTENSION
- Dave's Take: Pragmatic/direct perspective synthesized from post facts and comments.
- Sarah's Take: Empathetic/analytical perspective that can agree, counter, or build on Dave's points.
- Discussion Dynamics: How the room interacts (e.g. shared disbelief, debating solutions, building on each other's points, extending post content with creative metaphors, and active caller back-and-forth).

## STEP 4: VERDICT & OUTRO
- Final Verdict: Combined host advice summary.
- Natural Sign-off: Natural sign-off and goodbye to the caller (e.g. "Alex, good luck with the lease mate, let us know how you go.").`;

export const STAGE2_DIALOGUE_SYSTEM_PROMPT = `You are a master scriptwriter for an authentic call-in talk radio show called "Social Radio".
Your job is to transform a Stage 1 Show Outline and Original Source Material into a fast-paced, dynamic 3-way call-in radio script.

=== CO-HOST & CALLER ROLES ===
Allowed Speakers: Dave, Sarah, Caller.

=== DIALOGUE RULES ===
1. Follow the Stage 1 Markdown Outline strictly.
2. Deliver Step 1 Host Intro following the DYNAMIC component ordering pattern specified in Stage 1 (do NOT use a static or repetitive intro structure).
3. Format every single line EXACTLY as:
   [Speaker Name]: Spoken text.
4. DYNAMIC 3-WAY CONVERSATION FLOW:
   - Dave and Sarah are EQUAL co-hosts with an organic, fluid dynamic:
     * They can agree and build on each other's points, jokes, and theories.
     * They can debate and push back against each other when they genuinely see things differently.
     * They can do BOTH in the same segment (e.g. agree on who is wrong, but debate the best solution).
     * Extend beyond the raw text: bring funny metaphors, explore unspoken motives, and weave top comments naturally into conversation.
   - CALLER PARTICIPATES THROUGHOUT: The Caller does NOT disappear after the intro. They stay engaged across the segment—reacting to hosts' jokes/advice, clarifying details, defending their decisions, and responding to follow-ups.
5. NATURAL SIGN-OFF & SEGUE:
   - Conclude the call with a natural conversational goodbye (e.g. "Thanks for the call Alex, good luck mate!" / "Cheers Dave, appreciate it!").
   - After the goodbye, the caller simply stops talking.
   - Dave and Sarah share a quick final reaction/joke before transitioning naturally to what's next.
   - ZERO artificial jargon: NEVER say "Line 2 clear", "Line dropped", or similar fake radio cues.
6. NATURAL SPOKEN CONVERSATION:
   - Write 100% natural conversational spoken English.
   - Use natural contractions ("didn't", "we've", "it's", "I'm").
   - Use natural conversational words and fillers ("Well,", "I mean,", "Haha,", "Honestly,").
   - Use punctuation pacing (ellipses "...", em-dashes "—", commas) to convey natural pauses, hesitation, and conversational rhythm.
   - STRICT PROHIBITION: NEVER write bracketed or parenthetical stage directions, sound cues, or meta-tags (e.g. NO "[laughs]", NO "(sighs)", NO "[pause]", NO "[clears throat]"). All emotional nuances must be written purely as natural spoken words and punctuation.
7. Zero corporate greetings, zero Reddit jargon ("OP", "upvote", "subreddit").
8. Aim to explore thread content comprehensively and only skip nonsense or repetitive comments.`;

const ALLOWED_SPEAKERS = new Set(['Dave', 'Sarah', 'Caller']);

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

  validateOutline(outlineText: string): boolean {
    if (!outlineText || outlineText.trim().length === 0) {
      return false;
    }
    const hasStep1 = /STEP 1/i.test(outlineText);
    const hasStep2 = /STEP 2/i.test(outlineText);
    const hasStep3 = /STEP 3/i.test(outlineText);
    const hasStep4 = /STEP 4/i.test(outlineText);
    return hasStep1 && hasStep2 && hasStep3 && hasStep4;
  }

  parseScriptText(postId: string, rawText: string): ScriptData {
    const lines = rawText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const turns: ScriptTurn[] = [];

    for (const line of lines) {
      // Ignore section headers and markdown dividers
      if (
        line.startsWith('---') ||
        line.startsWith('===') ||
        line.startsWith('#') ||
        /^\[STEP \d/i.test(line)
      ) {
        continue;
      }

      const match = line.match(/^\[?([A-Za-z]+)\]?:\s*(.+)$/);
      if (match) {
        const speaker = match[1];
        const text = match[2].trim();

        if (!ALLOWED_SPEAKERS.has(speaker)) {
          throw new Error(
            `Invalid speaker encountered in script: "${speaker}"`,
          );
        }
        turns.push({ speaker, text });
      } else if (turns.length > 0) {
        // Multi-line continuation: append to previous speaker's turn
        turns[turns.length - 1].text += ` ${line}`;
      } else {
        throw new Error(`Unparseable line at start of script: "${line}"`);
      }
    }

    if (turns.length < 5) {
      throw new Error(
        `Script generated insufficient valid turns (${turns.length})`,
      );
    }

    return { postId, turns };
  }

  async generateScript(
    posts: PostData[],
    comments: CommentData[],
  ): Promise<ScriptData> {
    const startMs = Date.now();
    const primaryPost = posts[0];
    if (!primaryPost) {
      throw new Error('Cannot generate script without posts');
    }

    let sourceMaterial = `Title: ${primaryPost.title}\n`;
    sourceMaterial += `Dilemma Details: ${primaryPost.body || 'No details provided'}\n`;

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const postComments = comments.filter((c) => c.postId === post.id);
      if (postComments.length > 0) {
        sourceMaterial += `Public Stances & Arguments (nested threads):\n`;
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

        const postBaseWords = (post.title + ' ' + (post.body || ''))
          .split(/\s+/)
          .filter(Boolean).length;
        let currentWordCount = postBaseWords;
        const selectedComments: CommentData[] = [];
        const sortedTopLevel = [...topLevel].sort((a, b) => b.score - a.score);

        for (const topComment of sortedTopLevel) {
          if (currentWordCount >= 2500) break;
          const chainList: CommentData[] = [];
          const chainWords = this.collectChain(
            topComment,
            repliesMap,
            chainList,
          );

          if (currentWordCount + chainWords > 3500) break;

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
          sourceMaterial += `${indent}- ${label}: "${c.body}" (Score: ${c.score})\n`;

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
      sourceMaterial += `\n`;
    }

    // === STAGE 1: OUTLINE GENERATION (Up to 5 attempts) ===
    let outlineMarkdown = '';
    let stage1Attempts = 0;
    const stage1UserPrompt = `Here is the topic for the call-in segment:\n\n${sourceMaterial}\nPlease generate the Stage 1 Call-In Segment Outline now.`;

    while (stage1Attempts < 5) {
      stage1Attempts++;
      try {
        outlineMarkdown = await this.llmService.generateText(
          STAGE1_OUTLINE_SYSTEM_PROMPT,
          stage1UserPrompt,
        );
        if (this.validateOutline(outlineMarkdown)) {
          break;
        }
        this.logger.warn(
          { attempt: stage1Attempts },
          'Stage 1 outline validation failed, retrying Stage 1',
        );
      } catch (err) {
        this.logger.warn(
          {
            attempt: stage1Attempts,
            err: err instanceof Error ? err.message : String(err),
          },
          'Stage 1 LLM call failed, retrying Stage 1',
        );
      }
    }

    if (!this.validateOutline(outlineMarkdown)) {
      throw new Error(
        'Failed to generate a valid Stage 1 outline after 5 attempts',
      );
    }

    // === STAGE 2: FULL DIALOGUE GENERATION (Up to 5 attempts) ===
    const stage2UserPrompt = `=== STAGE 1 SHOW OUTLINE (Follow this Markdown roadmap strictly) ===\n${outlineMarkdown}\n\n=== ORIGINAL SOURCE MATERIAL (Use for rich dialogue details & quotes) ===\n${sourceMaterial}\n\nPlease write the complete spoken dialogue script now following the Stage 1 outline.`;

    let scriptData: ScriptData | null = null;
    let stage2Attempts = 0;

    while (stage2Attempts < 5) {
      stage2Attempts++;
      try {
        const rawDialogue = await this.llmService.generateText(
          STAGE2_DIALOGUE_SYSTEM_PROMPT,
          stage2UserPrompt,
        );
        scriptData = this.parseScriptText(primaryPost.id, rawDialogue);
        if (scriptData.turns.length >= 5) {
          break;
        }
      } catch (err) {
        this.logger.warn(
          {
            attempt: stage2Attempts,
            err: err instanceof Error ? err.message : String(err),
          },
          'Stage 2 dialogue parsing failed, retrying Stage 2',
        );
      }
    }

    if (!scriptData || scriptData.turns.length < 5) {
      throw new Error(
        'Failed to generate valid Stage 2 dialogue after 5 attempts',
      );
    }

    const totalWords = scriptData.turns.reduce(
      (sum, t) => sum + t.text.split(/\s+/).filter(Boolean).length,
      0,
    );

    this.logger.info(
      {
        postId: primaryPost.id,
        turns: scriptData.turns.length,
        outputWords: totalWords,
        stage1Attempts,
        stage2Attempts,
        ms: Date.now() - startMs,
      },
      '2-Stage LLM script generation finished',
    );

    return scriptData;
  }
}
