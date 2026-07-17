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

    it('should select complete comment chains until the 1500-word input budget is met, then exclude further chains', async () => {
      // Post title + body = 10 words
      const posts = [
        { id: 'post-1', title: 'A B C D E', body: 'F G H I J' },
      ] as unknown as Post[];

      // Comment Chain 1 (top-level c1 + reply r1): 800 words total
      // c1: 400 words
      const c1Body = 'alpha '.repeat(400).trim();
      // r1 (reply to c1): 400 words
      const r1Body = 'beta '.repeat(400).trim();

      // Comment Chain 2 (top-level c2): 700 words total
      // c2: 700 words
      const c2Body = 'gamma '.repeat(700).trim();

      // Comment Chain 3 (top-level c3): 500 words total
      // c3: 500 words
      const c3Body = 'delta '.repeat(500).trim();

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
      // Post (10 words) + Chain 1 (800 words) = 810 words (under 1500)
      // + Chain 2 (700 words) = 1510 words (meets/exceeds 1500, loop should terminate)
      // Chain 3 (500 words) should be completely excluded

      expect(calledUserPrompt).toContain(c1Body);
      expect(calledUserPrompt).toContain(r1Body); // Reply must be included (entire chain preserved)
      expect(calledUserPrompt).toContain(c2Body);
      expect(calledUserPrompt).not.toContain(c3Body); // Chain 3 should be excluded
    });
  });
});
