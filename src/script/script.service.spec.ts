import { Test, TestingModule } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { ScriptService } from './script.service';
import { LlmService } from './llm.service';
import { PostData, CommentData } from '../domain';

describe('ScriptService', () => {
  let service: ScriptService;

  const mockLlmService = {
    generateText: jest.fn(),
  };

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

  describe('generateScript', () => {
    it('should format posts and comments, call LlmService.generateText, and return script text', async () => {
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

      mockLlmService.generateText.mockResolvedValue(
        'Mocked radio script text.',
      );

      const result = await service.generateScript(posts, comments);

      expect(mockLlmService.generateText).toHaveBeenCalledWith(
        expect.stringContaining(
          'You are a professional script writer for a call-in',
        ),
        expect.stringContaining('Post Title 1'),
      );
      expect(result).toBe('Mocked radio script text.');
    });

    it('logs ONE LLM call line with sizes + latency at info', async () => {
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

      mockLlmService.generateText.mockResolvedValue(
        'Mocked radio script text.',
      );

      const infoSpy = jest
        .spyOn(PinoLogger.prototype, 'info')
        .mockImplementation(() => {});

      await service.generateScript(posts, comments);

      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          posts: 1,
          comments: 1,
          inputWords: expect.any(Number) as number,
          outputWords: expect.any(Number) as number,
          ms: expect.any(Number) as number,
        }),
        expect.stringContaining('LLM'),
      );
    });

    it('should select complete comment chains until the 2500-word input budget is met, then exclude further chains', async () => {
      const posts: PostData[] = [
        {
          id: 'post-1',
          subredditId: 'sub-1',
          redditId: 'r1',
          title: 'A B C D E',
          body: 'F G H I J',
          score: 10,
        },
      ];

      const c1Body = 'alpha '.repeat(600).trim();
      const r1Body = 'beta '.repeat(600).trim();
      const c2Body = 'gamma '.repeat(600).trim();
      const c3Body = 'delta '.repeat(600).trim();

      const comments: CommentData[] = [
        {
          id: 'c1',
          postId: 'post-1',
          redditId: 'comment-1',
          parentRedditId: null,
          body: c1Body,
          score: 100,
          isOp: false,
        },
        {
          id: 'r1',
          postId: 'post-1',
          redditId: 'reply-1',
          parentRedditId: 'comment-1',
          body: r1Body,
          score: 90,
          isOp: false,
        },
        {
          id: 'c2',
          postId: 'post-1',
          redditId: 'comment-2',
          parentRedditId: null,
          body: c2Body,
          score: 80,
          isOp: false,
        },
        {
          id: 'c3',
          postId: 'post-1',
          redditId: 'comment-3',
          parentRedditId: null,
          body: c3Body,
          score: 60,
          isOp: false,
        },
      ];

      let calledUserPrompt = '';
      mockLlmService.generateText.mockImplementation(
        (_sys: string, user: string) => {
          calledUserPrompt = user;
          return Promise.resolve('Script content');
        },
      );

      await service.generateScript(posts, comments);

      expect(calledUserPrompt).toContain(c1Body);
      expect(calledUserPrompt).toContain(r1Body);
      expect(calledUserPrompt).toContain(c2Body);
      expect(calledUserPrompt).toContain(c3Body);
    });

    it('should enforce a 3500-word max ceiling guard and exclude a chain if adding it exceeds 3500 total words', async () => {
      const posts: PostData[] = [
        {
          id: 'post-1',
          subredditId: 'sub-1',
          redditId: 'r1',
          title: 'A B C D E',
          body: 'F G H I J',
          score: 10,
        },
      ];

      const c1Body = 'alpha '.repeat(2400).trim();
      const c2Body = 'beta '.repeat(1200).trim();

      const comments: CommentData[] = [
        {
          id: 'c1',
          postId: 'post-1',
          redditId: 'comment-1',
          parentRedditId: null,
          body: c1Body,
          score: 100,
          isOp: false,
        },
        {
          id: 'c2',
          postId: 'post-1',
          redditId: 'comment-2',
          parentRedditId: null,
          body: c2Body,
          score: 80,
          isOp: false,
        },
      ];

      let calledUserPrompt = '';
      mockLlmService.generateText.mockImplementation(
        (_sys: string, user: string) => {
          calledUserPrompt = user;
          return Promise.resolve('Script content');
        },
      );

      await service.generateScript(posts, comments);

      expect(calledUserPrompt).toContain(c1Body);
      expect(calledUserPrompt).not.toContain(c2Body);
    });
  });
});
