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
- Natural Sign-off: Natural sign-off and goodbye to the caller (e.g. "Alex, good luck with the lease mate, let us know how you go.").
- Conciseness: Keep each bullet point brief and punchy. The entire outline must be under 250 words total.`;

export const STAGE2_DIALOGUE_SYSTEM_PROMPT = `You are a master scriptwriter for an authentic call-in talk radio show called "Social Radio".
Your job is to transform a Stage 1 Show Outline and Original Source Material into a fast-paced, dynamic 3-way call-in radio script.

=== CO-HOST & CALLER ROLES ===
Allowed Speakers: Dave, Sarah, Caller.

=== DIALOGUE RULES ===
1. Follow the Stage 1 Markdown Outline strictly.
2. Deliver Step 1 Host Intro following the DYNAMIC component ordering pattern specified in Stage 1 (do NOT use a static or repetitive intro structure).
3. Format every single line EXACTLY with one of these three speaker prefixes:
   Dave: Spoken text
   Sarah: Spoken text
   Caller: Spoken text
   (CRITICAL: Even if a caller name was created in Stage 1 like Marcus or Alex, ALWAYS use "Caller:" as the line prefix. Never prefix lines with the caller's personal name.)
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
8. Pacing & Length: Aim for a tight, high-energy 8 to 14 dialogue turns total (approx 200-350 words spoken airtime). Keep turns punchy (1-3 sentences per turn).
9. Aim to explore thread content concisely and skip repetitive comments.`;

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

  private normalizeSpeaker(speaker: string): string {
    if (speaker === 'Host' || speaker === 'Lead') return 'Dave';
    if (speaker === 'CoHost' || speaker === 'Co-Host') return 'Sarah';
    if (speaker === 'Guest' || speaker === 'OP') return 'Caller';
    return speaker;
  }

  parseScriptText(postId: string, text: string): ScriptData {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const turns: ScriptTurn[] = [];

    for (const rawLine of lines) {
      // Clean leading bullet points or markdown headers
      const line = rawLine.replace(/^[*-\d.\s]+/, '').trim();

      // Ignore section headers and markdown dividers
      if (
        line.startsWith('---') ||
        line.startsWith('===') ||
        line.startsWith('#') ||
        /^\[STEP \d/i.test(line)
      ) {
        continue;
      }

      // Match speaker prefix like **Dave:**, **Dave**:, [Dave]:, Dave:, Dave (Host):, **Dave (Host)**:
      const match = line.match(
        /^\*{0,2}\[?([A-Za-z-]+)(?:\s*\([^)]*\))?\]?\*{0,2}\s*:\*{0,2}\s*(.+)$/,
      );
      if (match) {
        const rawSpeaker = match[1];
        const speaker = this.normalizeSpeaker(rawSpeaker);
        if (!ALLOWED_SPEAKERS.has(speaker)) {
          throw new Error(
            `Invalid speaker encountered in script: "${speaker}"`,
          );
        }
        const text = match[2].replace(/^\*\*|\*\*$/g, '').trim();
        turns.push({ speaker, text });
        continue;
      }

      if (turns.length > 0) {
        // Multi-line continuation: append to previous speaker's turn
        turns[turns.length - 1].text +=
          ` ${rawLine.replace(/^\*\*|\*\*$/g, '').trim()}`;
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

        const sortedTop = topLevel.sort((a, b) => b.score - a.score);
        let count = 0;
        for (const top of sortedTop) {
          if (count >= 5) break;
          const chainList: CommentData[] = [];
          this.collectChain(top, repliesMap, chainList);

          for (const item of chainList) {
            const indent = item.parentRedditId ? '  - Reply: ' : '- Comment: ';
            const label = item.isOp ? '[Caller Reply]' : '[Public Stance]';
            sourceMaterial += `${indent}${label} (${item.score} pts): ${item.body}\n`;
          }
          count++;
        }
      }
      sourceMaterial += `\n`;
    }

    // === STAGE 1: OUTLINE GENERATION (Up to 2 attempts) ===
    let outlineMarkdown = '';
    let stage1Attempts = 0;
    const stage1UserPrompt = `Here is the topic for the call-in segment:\n\n${sourceMaterial}\nPlease generate the Stage 1 Call-In Segment Outline now.`;

    process.stderr.write(
      `[ScriptService] Starting Stage 1 outline generation (post: ${primaryPost.id})...\n`,
    );
    while (stage1Attempts < 2) {
      stage1Attempts++;
      try {
        process.stderr.write(
          `[ScriptService] Calling LLM for Stage 1 (attempt ${stage1Attempts})...\n`,
        );
        outlineMarkdown = await this.llmService.generateText(
          STAGE1_OUTLINE_SYSTEM_PROMPT,
          stage1UserPrompt,
        );
        process.stderr.write(
          `[ScriptService] Stage 1 LLM response received (${outlineMarkdown.length} chars), validating...\n`,
        );
        if (this.validateOutline(outlineMarkdown)) {
          process.stderr.write(
            `[ScriptService] Stage 1 outline validated successfully!\n`,
          );
          break;
        }
        process.stderr.write(
          `[ScriptService] Stage 1 validation failed on attempt ${stage1Attempts}\n`,
        );
        this.logger.warn(
          { attempt: stage1Attempts },
          'Stage 1 outline validation failed, retrying Stage 1',
        );
      } catch (err) {
        process.stderr.write(
          `[ScriptService] Stage 1 LLM call error on attempt ${stage1Attempts}: ${err instanceof Error ? err.stack || err.message : String(err)}\n`,
        );
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
        'Failed to generate a valid Stage 1 outline after 2 attempts',
      );
    }

    // === STAGE 2: FULL DIALOGUE GENERATION (Up to 2 attempts) ===
    const stage2UserPrompt = `=== STAGE 1 SHOW OUTLINE (Follow this Markdown roadmap strictly) ===\n${outlineMarkdown}\n\n=== ORIGINAL SOURCE MATERIAL (Use for rich dialogue details & quotes) ===\n${sourceMaterial}\n\nPlease write the complete spoken dialogue script now following the Stage 1 outline.`;

    let scriptData: ScriptData | null = null;
    let stage2Attempts = 0;

    process.stderr.write(
      `[ScriptService] Starting Stage 2 dialogue generation...\n`,
    );
    while (stage2Attempts < 2) {
      stage2Attempts++;
      try {
        process.stderr.write(
          `[ScriptService] Calling LLM for Stage 2 (attempt ${stage2Attempts})...\n`,
        );
        const rawDialogue = await this.llmService.generateText(
          STAGE2_DIALOGUE_SYSTEM_PROMPT,
          stage2UserPrompt,
        );
        process.stderr.write(
          `[ScriptService] Stage 2 LLM response received (${rawDialogue.length} chars), parsing turns...\n`,
        );
        scriptData = this.parseScriptText(primaryPost.id, rawDialogue);
        process.stderr.write(
          `[ScriptService] Parsed ${scriptData.turns.length} turns\n`,
        );
        if (scriptData.turns.length >= 5) {
          process.stderr.write(
            `[ScriptService] Stage 2 dialogue valid with ${scriptData.turns.length} turns!\n`,
          );
          break;
        }
      } catch (err) {
        process.stderr.write(
          `[ScriptService] Stage 2 error on attempt ${stage2Attempts}: ${err instanceof Error ? err.stack || err.message : String(err)}\n`,
        );
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
        'Failed to generate valid Stage 2 dialogue after 2 attempts',
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
