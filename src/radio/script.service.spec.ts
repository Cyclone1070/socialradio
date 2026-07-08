import { Test, TestingModule } from '@nestjs/testing';
import { ScriptService } from './script.service';
import { LlmService } from '../llm/llm.service';

describe('ScriptService', () => {
  let service: ScriptService;
  let llmService: LlmService;

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
    llmService = module.get<LlmService>(LlmService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateScript', () => {
    it('should format posts and comments, call LlmService, and return script text', async () => {
      const posts = [
        { title: 'Post Title 1', body: 'Post Body 1', author: 'author1' },
      ] as any[];

      const comments = [
        { body: 'Comment Body 1', author: 'user1', postId: 'post-1' },
      ] as any[];

      mockLlmService.generateText.mockResolvedValue('Mocked radio script text.');

      const result = await (service as any).generateScript(posts, comments);

      expect(mockLlmService.generateText).toHaveBeenCalledWith(
        expect.stringContaining('You are a professional radio news anchor'),
        expect.stringContaining('Post Title 1'),
      );
      expect(result).toBe('Mocked radio script text.');
    });
  });
});
