import { Test, TestingModule } from '@nestjs/testing';
import { ScriptService } from './script.service';
import { LlmService } from '../llm/llm.service';
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
  });
});
