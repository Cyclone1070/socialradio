import { Test, TestingModule } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { ScriptService } from './script.service';
import { LlmService } from './llm.service';
import { PostData, CommentData } from '../domain';

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

## STEP 3: ROOM STANCES & GAP ANGLES
- Mike's Stance: 50/50 lease is binding
- Sarah's Stance: Pay 55/45 max
- Jenny's Gap Angle: Roommate lost job recently

## STEP 4: VERDICT & OUTRO
- Final Verdict: Pay 55/45
- Line Drop Phrase: Line 2 clear.`;

  const validDialogueText = `Dave: Next up, we've got Alex from Wollongong on Line 2.
Caller: Hey Dave! My roommate is demanding 70% rent.
Sarah: [laughs] 70%?! Is his room a broom closet?
Mike: If the lease says 50/50, he can't change it.
Jenny: Did he lose his job recently?
Caller: Actually yeah, two weeks ago!
Dave: Alex, stick to 55/45. Line 2 clear.
[Line Cut Sound]
Dave: Up next, another crazy story.`;

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

  it('should be defined', () => {
    expect(service).toBeDefined();
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
Mike: Mike line.
Jenny: Jenny line.`;

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
Mike: Yo.`;

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
      expect(result.turns.length).toBe(8);
      expect(result.turns[0].speaker).toBe('Dave');
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
      expect(result.turns.length).toBe(8);
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
      expect(result.turns.length).toBe(8);
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
          turns: 8,
          stage1Attempts: 1,
          stage2Attempts: 1,
          ms: expect.any(Number) as number,
        }),
        expect.stringContaining('2-Stage LLM script generation'),
      );
    });
  });
});
