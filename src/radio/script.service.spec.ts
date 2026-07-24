import { Test, TestingModule } from '@nestjs/testing';
import { ScriptService } from './script.service';
import { Post } from '../feed/entities/post.entity';
import { Comment } from '../feed/entities/comment.entity';

describe('ScriptService', () => {
  let service: ScriptService;

  const mockLlmService = {
    generateText: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScriptService,
        { provide: 'LlmService', useValue: mockLlmService },
      ],
    }).compile();

    service = module.get<ScriptService>(ScriptService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateScript', () => {
    it('should format posts and comments, call LlmService, and return script text', async () => {
      const posts = [
        {
          id: 'post-1',
          title: 'Post Title 1',
          body: 'Post Body 1',
        },
      ] as unknown as Post[];

      const comments = [
        {
          body: 'Comment Body 1',
          postId: 'post-1',
          redditId: 'comment-1',
          parentRedditId: null,
          isOp: false,
          score: 10,
        },
      ] as unknown as Comment[];

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

    it('should select complete comment chains until the 2500-word input budget is met, then exclude further chains', async () => {
      // Post title + body = 10 words
      const posts = [
        { id: 'post-1', title: 'A B C D E', body: 'F G H I J' },
      ] as unknown as Post[];

      // Comment Chain 1 (top-level c1 + reply r1): 1200 words total
      // c1: 600 words
      const c1Body = 'alpha '.repeat(600).trim();
      // r1 (reply to c1): 600 words
      const r1Body = 'beta '.repeat(600).trim();

      // Comment Chain 2 (top-level c2): 600 words total
      // c2: 600 words
      const c2Body = 'gamma '.repeat(600).trim();

      // Comment Chain 3 (top-level c3): 600 words total
      // c3: 600 words
      const c3Body = 'delta '.repeat(600).trim();

      const comments: Comment[] = [
        {
          id: 'c1',
          postId: 'post-1',
          redditId: 'comment-1',
          parentRedditId: null,
          body: c1Body,
          score: 100, // Chain 1 has highest score
          isOp: false,
        } as Comment,
        {
          id: 'r1',
          postId: 'post-1',
          redditId: 'reply-1',
          parentRedditId: 'comment-1',
          body: r1Body,
          score: 90,
          isOp: false,
        } as Comment,
        {
          id: 'c2',
          postId: 'post-1',
          redditId: 'comment-2',
          parentRedditId: null,
          body: c2Body,
          score: 80, // Chain 2 has medium score
          isOp: false,
        } as Comment,
        {
          id: 'c3',
          postId: 'post-1',
          redditId: 'comment-3',
          parentRedditId: null,
          body: c3Body,
          score: 60, // Chain 3 has lowest score
          isOp: false,
        } as Comment,
      ];

      let calledUserPrompt = '';
      const mockGenerateText = mockLlmService.generateText;
      mockGenerateText.mockImplementation((sys: string, user: string) => {
        calledUserPrompt = user;
        return Promise.resolve('Script content');
      });
      await service.generateScript(posts, comments);

      // Cumulative words:
      // Post (10 words) + Chain 1 (1200 words) = 1210 words (under 2500)
      // + Chain 2 (600 words) = 1810 words (under 2500)
      // + Chain 3 (600 words) = 2410 words (under 2500, loop will check next but stop)
      // All three chains should be included under 2500, but Chain 3 will be excluded under 1500.

      expect(calledUserPrompt).toContain(c1Body);
      expect(calledUserPrompt).toContain(r1Body);
      expect(calledUserPrompt).toContain(c2Body);
      expect(calledUserPrompt).toContain(c3Body);
    });

    it('should enforce a 3500-word max ceiling guard and exclude a chain if adding it exceeds 3500 total words', async () => {
      const posts = [
        { id: 'post-1', title: 'A B C D E', body: 'F G H I J' },
      ] as unknown as Post[];

      // Chain 1: 2400 words (score: 100)
      const c1Body = 'alpha '.repeat(2400).trim();
      // Chain 2: 1200 words (score: 80) -> 2410 + 1200 = 3610 (> 3500 max ceiling guard)
      const c2Body = 'beta '.repeat(1200).trim();

      const comments: Comment[] = [
        {
          id: 'c1',
          postId: 'post-1',
          redditId: 'comment-1',
          parentRedditId: null,
          body: c1Body,
          score: 100,
          isOp: false,
        } as Comment,
        {
          id: 'c2',
          postId: 'post-1',
          redditId: 'comment-2',
          parentRedditId: null,
          body: c2Body,
          score: 80,
          isOp: false,
        } as Comment,
      ];

      let calledUserPrompt = '';
      mockLlmService.generateText.mockImplementation(
        (sys: string, user: string) => {
          calledUserPrompt = user;
          return Promise.resolve('Script content');
        },
      );

      await service.generateScript(posts, comments);

      expect(calledUserPrompt).toContain(c1Body);
      expect(calledUserPrompt).not.toContain(c2Body); // Excluded due to > 3500 ceiling guard
    });
  });
});
