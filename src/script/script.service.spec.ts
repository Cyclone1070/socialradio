import { Test, TestingModule } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { ScriptService } from './script.service';
import { LlmService } from './llm.service';
import { PostData, CommentData } from '../content/types/post.types';

describe('ScriptService (2-Stage Script Generation)', () => {
  let service: ScriptService;

  const mockLlmService = {
    generateText: jest.fn(),
  };

  const validOutlineMarkdown = `# CALL-IN SEGMENT OUTLINE
## STEP 1: HOST INTRO & HOOK
- Lead-in: Next up,
- Hook Angle: A wild story about rent
- Caller & Location: Alex from Wollongong
- Line Number: Line 2

## STEP 2: CALLER NARRATIVE BEATS
- Alex explains the 70% rent split demand

## STEP 3: ROOM STANCES
- Dave's Angle: Lease terms vs fairness
- Sarah's Stance: Pay 55/45 max

## STEP 4: VERDICT & OUTRO
- Final Verdict: Pay 55/45
- Natural Sign-off: Thanks for calling Alex, good luck mate!`;

  const validDialogueText = `Dave: Next up, we've got Alex from Wollongong on Line 2.
Caller: Hey Dave! My roommate is demanding 70% rent.
Sarah: 70%?! Is his room a broom closet?
Dave: If the lease says 50/50, he can't change it.
Sarah: Did he lose his job recently?
Caller: Actually yeah, two weeks ago!
Dave: Alex, stick to 55/45. Good luck with the landlord mate!
Caller: Thanks Dave, will do!
Sarah: Unbelievable roommate, honestly.`;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScriptService,
        { provide: LlmService, useValue: mockLlmService },
      ],
    }).compile();

    service = module.get<ScriptService>(ScriptService);
    jest.clearAllMocks();
  });

  describe('validateOutline', () => {
    it('should return true for valid outline containing all 4 STEP headers', () => {
      expect(service.validateOutline(validOutlineMarkdown)).toBe(true);
    });

    it('should return false for incomplete outline missing STEP 4', () => {
      const invalid = validOutlineMarkdown.replace('## STEP 4', '## SECTION 4');
      expect(service.validateOutline(invalid)).toBe(false);
    });
  });

  describe('parseScriptText', () => {
    it('should parse valid dialogue lines and multi-line continuations into ScriptData', () => {
      const multiLineText = `Dave: First line of host.
Second line of host.
Caller: Caller response line.
Sarah: Sarah line.
Dave: Dave wrap line.
Sarah: Final reaction.`;

      const parsed = service.parseScriptText('post-1', multiLineText);

      expect(parsed.postId).toBe('post-1');
      expect(parsed.turns.length).toBe(5);
      expect(parsed.turns[0]).toEqual({
        speaker: 'Dave',
        text: 'First line of host. Second line of host.',
      });
      expect(parsed.turns[1]).toEqual({
        speaker: 'Caller',
        text: 'Caller response line.',
      });
    });

    it('should throw error when encountering an unknown speaker', () => {
      const invalidSpeaker = `Dave: Hello.
UnknownSpeaker: Unexpected.
Caller: Hi.
Sarah: Hey.
Dave: Wrap.`;

      expect(() => service.parseScriptText('post-1', invalidSpeaker)).toThrow(
        'Invalid speaker encountered in script: "UnknownSpeaker"',
      );
    });
  });

  describe('generateScript', () => {
    it('should execute 2-stage generation (Outline -> Dialogue) and return ScriptData', async () => {
      const posts: PostData[] = [
        {
          id: 'post-1',
          subredditId: 'sub-1',
          redditId: 'r1',
          title: 'Post Title 1',
          body: 'Post Body 1',
          score: 10,
        },
      ];
      const comments: CommentData[] = [
        {
          id: 'c1',
          postId: 'post-1',
          redditId: 'comment-1',
          body: 'Comment Body 1',
          parentRedditId: null,
          isOp: false,
          score: 10,
        },
      ];

      // Call 1 -> Stage 1 Outline, Call 2 -> Stage 2 Dialogue
      mockLlmService.generateText
        .mockResolvedValueOnce(validOutlineMarkdown)
        .mockResolvedValueOnce(validDialogueText);

      const result = await service.generateScript(posts, comments);

      expect(mockLlmService.generateText).toHaveBeenCalledTimes(2);
      expect(result.postId).toBe('post-1');
      expect(result.turns.length).toBe(9);
      expect(result.turns[0].speaker).toBe('Dave');
    });

    it('tells Stage 1 what was wrong and shows the rejected outline', async () => {
      const posts: PostData[] = [
        {
          id: 'post-1',
          subredditId: 'sub-1',
          redditId: 'r1',
          title: 'Post Title 1',
          body: 'Post Body 1',
          score: 10,
        },
      ];

      mockLlmService.generateText
        .mockResolvedValueOnce('Invalid outline without steps')
        .mockResolvedValueOnce(validOutlineMarkdown)
        .mockResolvedValueOnce(validDialogueText);

      const result = await service.generateScript(posts, []);

      expect(result.turns.length).toBe(9);
      // The retry must carry the failure, not re-roll the same prompt.
      const repairPrompt = String(
        (mockLlmService.generateText.mock.calls[1] as string[])[1],
      );
      expect(repairPrompt).toContain('Invalid outline without steps');
      expect(repairPrompt).toContain('STEP');
    });

    it('tells Stage 2 what was wrong and shows the rejected dialogue', async () => {
      const posts: PostData[] = [
        {
          id: 'post-1',
          subredditId: 'sub-1',
          redditId: 'r1',
          title: 'Post Title 1',
          body: 'Post Body 1',
          score: 10,
        },
      ];

      mockLlmService.generateText
        .mockResolvedValueOnce(validOutlineMarkdown)
        .mockResolvedValueOnce(
          'Dave: Hello.\nUnknownSpeaker: Oops.\nDave: Bye.',
        )
        .mockResolvedValueOnce(validDialogueText);

      const result = await service.generateScript(posts, []);

      expect(result.turns.length).toBe(9);
      const repairPrompt = String(
        (mockLlmService.generateText.mock.calls[2] as string[])[1],
      );
      expect(repairPrompt).toContain('UnknownSpeaker');
    });

    it('throws instead of inventing a script when Stage 1 keeps failing', async () => {
      const posts: PostData[] = [
        {
          id: 'post-1',
          subredditId: 'sub-1',
          redditId: 'r1',
          title: 'Post Title 1',
          body: 'Post Body 1',
          score: 10,
        },
      ];

      mockLlmService.generateText.mockResolvedValue(
        'Invalid outline without steps',
      );

      // Exhaustion is content, not infrastructure: it comes back as a value so
      // the caller can retire the topic instead of retrying it forever.
      const outcome = await service.generateScript(posts, []);
      expect(outcome).toMatchObject({ rejected: true });
      const rejected = outcome as { reason?: string; turns?: unknown };
      expect(String(rejected.reason)).toContain('Stage 1');
      expect(mockLlmService.generateText).toHaveBeenCalledTimes(2);
    });

    it('throws instead of inventing a script when Stage 2 keeps failing', async () => {
      const posts: PostData[] = [
        {
          id: 'post-1',
          subredditId: 'sub-1',
          redditId: 'r1',
          title: 'Post Title 1',
          body: 'Post Body 1',
          score: 10,
        },
      ];

      mockLlmService.generateText
        .mockResolvedValueOnce(validOutlineMarkdown)
        .mockResolvedValue('Dave: one turn is not a conversation');

      const outcome = await service.generateScript(posts, []);
      expect(outcome).toMatchObject({ rejected: true });
      const rejected = outcome as { reason?: string; turns?: unknown };
      expect(String(rejected.reason)).toContain('Stage 2');
    });

    it('should retry Stage 1 when Stage 1 outline validation fails', async () => {
      const posts: PostData[] = [
        {
          id: 'post-1',
          subredditId: 'sub-1',
          redditId: 'r1',
          title: 'Post Title 1',
          body: 'Post Body 1',
          score: 10,
        },
      ];

      // Call 1 -> Invalid Outline, Call 2 -> Valid Outline, Call 3 -> Valid Dialogue
      mockLlmService.generateText
        .mockResolvedValueOnce('Invalid outline without steps')
        .mockResolvedValueOnce(validOutlineMarkdown)
        .mockResolvedValueOnce(validDialogueText);

      const result = await service.generateScript(posts, []);

      expect(mockLlmService.generateText).toHaveBeenCalledTimes(3);
      expect(result.turns.length).toBe(9);
    });

    it('should retry Stage 2 when Stage 2 dialogue parsing fails', async () => {
      const posts: PostData[] = [
        {
          id: 'post-1',
          subredditId: 'sub-1',
          redditId: 'r1',
          title: 'Post Title 1',
          body: 'Post Body 1',
          score: 10,
        },
      ];

      // Call 1 -> Valid Outline, Call 2 -> Malformed Dialogue, Call 3 -> Valid Dialogue
      mockLlmService.generateText
        .mockResolvedValueOnce(validOutlineMarkdown)
        .mockResolvedValueOnce('Malformed dialogue without speaker prefix')
        .mockResolvedValueOnce(validDialogueText);

      const result = await service.generateScript(posts, []);

      expect(mockLlmService.generateText).toHaveBeenCalledTimes(3);
      expect(result.turns.length).toBe(9);
    });

    it('logs 2-Stage generation metrics at info level', async () => {
      const posts: PostData[] = [
        {
          id: 'post-1',
          subredditId: 'sub-1',
          redditId: 'r1',
          title: 'Post Title 1',
          body: 'Post Body 1',
          score: 10,
        },
      ];

      mockLlmService.generateText
        .mockResolvedValueOnce(validOutlineMarkdown)
        .mockResolvedValueOnce(validDialogueText);

      const infoSpy = jest
        .spyOn(PinoLogger.prototype, 'info')
        .mockImplementation(() => {});

      await service.generateScript(posts, []);

      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          postId: 'post-1',
          turns: 9,
          stage1Attempts: 1,
          stage2Attempts: 1,
          ms: expect.any(Number) as number,
        }),
        expect.stringContaining('2-Stage LLM script generation'),
      );
    });
  });
});

describe('the continuity directive', () => {
  const OUTLINE = `# OUTLINE
## STEP 1: HOST INTRO & HOOK
- Hook Angle: rent

## STEP 2: CALLER NARRATIVE BEATS
- Alex explains

## STEP 3: ROOM STANCES
- Dave's Angle: lease terms

## STEP 4: VERDICT & OUTRO
- Verdict: stick to 55/45`;

  const DIALOGUE = `Dave: Next up, we have Alex on Line 2.
Caller: Hey Dave! My roommate wants 70% of the rent.
Sarah: 70%? Is his room a broom closet?
Dave: If the lease says 50/50, he cannot change it.
Sarah: Did he lose his job recently?
Caller: Actually yeah, two weeks ago!
Dave: Stick to 55/45. Good luck mate!`;

  it('is handed to the dialogue stage, because that is where the opening is written', async () => {
    const llmService = {
      generateText: jest
        .fn()
        .mockResolvedValueOnce(OUTLINE)
        .mockResolvedValueOnce(DIALOGUE),
    };
    const service = new ScriptService(llmService as unknown as LlmService);
    const posts: PostData[] = [
      {
        id: 'post-1',
        subredditId: 'sub-1',
        redditId: 'r1',
        title: 'Roommate wants 70% of the rent',
        body: 'Body',
        score: 10,
      },
    ];

    await service.generateScript(posts, [], 'DIRECTIVE HERE');

    expect(llmService.generateText).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.stringContaining('DIRECTIVE HERE'),
    );
  });
});

describe('a conversation that opens with the wrong thing', () => {
  const OUTLINE = `# OUTLINE
## STEP 1: HOST INTRO & HOOK
- Hook Angle: rent

## STEP 2: CALLER NARRATIVE BEATS
- Alex explains

## STEP 3: ROOM STANCES
- Dave's Angle: lease terms

## STEP 4: VERDICT & OUTRO
- Verdict: stick to 55/45`;

  const GREETING = `Dave: Welcome back to the show, everyone.
Caller: Thanks Dave! My roommate wants 70% of the rent.
Sarah: 70%? Is his room a broom closet?
Dave: If the lease says 50/50, he cannot change it.
Sarah: Did he lose his job recently?
Caller: Actually yeah, two weeks ago!`;

  const COMPLIANT = `Dave: Before the break, Alex told us about the rent split.
Caller: Thanks Dave! My roommate wants 70% of the rent.
Sarah: 70%? Is his room a broom closet?
Dave: If the lease says 50/50, he cannot change it.
Sarah: Did he lose his job recently?
Caller: Actually yeah, two weeks ago!`;

  const POSTS: PostData[] = [
    {
      id: 'post-1',
      subredditId: 'sub-1',
      redditId: 'r1',
      title: 'Roommate wants 70% of the rent',
      body: 'Body',
      score: 10,
    },
  ];

  function serviceReturning(...answers: string[]): {
    service: ScriptService;
    llm: { generateText: jest.Mock };
  } {
    const generateText = jest.fn();
    let call = 0;
    generateText.mockImplementation(() =>
      Promise.resolve(call++ === 0 ? OUTLINE : (answers.shift() ?? '')),
    );
    return {
      service: new ScriptService({ generateText } as unknown as LlmService),
      llm: { generateText },
    };
  }

  it('is asked again, and the second opening is the one that airs', async () => {
    const { service, llm } = serviceReturning(GREETING, COMPLIANT);

    const result = await service.generateScript(
      POSTS,
      [],
      'Pick up where the last conversation left off.',
      'pick-up-the-thread',
    );

    expect(llm.generateText).toHaveBeenCalledTimes(3);
    expect(result.turns[0].text).toContain('Before the break');
  });

  it('is refused when it opens with the wrong thing twice', async () => {
    const { service } = serviceReturning(GREETING, GREETING);

    const result = await service.generateScript(
      POSTS,
      [],
      'Pick up where the last conversation left off.',
      'pick-up-the-thread',
    );

    expect('rejected' in result && result.rejected).toBe(true);
    expect('rejected' in result && result.reason).toContain('opening');
  });
});

describe('the outline a conversation was written from', () => {
  const OUTLINE = `# CALL-IN SEGMENT OUTLINE
## STEP 1: HOST INTRO & HOOK
- Hook Angle: A wild story about rent

## STEP 2: CALLER NARRATIVE BEATS
- Alex explains the demand

## STEP 3: ROOM STANCES
- Dave's Angle: lease terms

## STEP 4: VERDICT & OUTRO
- Verdict: stick to 55/45`;

  const DIALOGUE = `Dave: Next up, we have Alex on Line 2.
Caller: Hey Dave! My roommate wants 70% of the rent.
Sarah: 70%? Is his room a broom closet?
Dave: If the lease says 50/50, he cannot change it.
Sarah: Did he lose his job recently?
Caller: Actually yeah, two weeks ago!
Dave: Stick to 55/45. Good luck mate!`;

  it('comes back with the script, because the next conversation reads it', async () => {
    const llmService = {
      generateText: jest
        .fn()
        .mockResolvedValueOnce(OUTLINE)
        .mockResolvedValueOnce(DIALOGUE),
    };
    const service = new ScriptService(llmService as unknown as LlmService);
    const posts: PostData[] = [
      {
        id: 'post-1',
        subredditId: 'sub-1',
        redditId: 'r1',
        title: 'Roommate wants 70% of the rent',
        body: 'Body',
        score: 10,
      },
    ];

    const result = await service.generateScript(posts, []);

    expect(result.outline).toBe(OUTLINE);
    expect(result.turns.length).toBeGreaterThanOrEqual(5);
  });
});
