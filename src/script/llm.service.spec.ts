import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';
import * as aiModule from 'ai';

jest.mock('ai', () => ({
  generateText: jest.fn(),
}));

jest.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: jest.fn(() => jest.fn(() => ({}))),
}));

describe('LlmService', () => {
  let service: LlmService;

  const mockGenerateText = aiModule.generateText as jest.Mock<any>;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'DEEPSEEK_API_KEY') return 'test-key';
      if (key === 'DEEPSEEK_MODEL') return 'deepseek-chat';
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<LlmService>(LlmService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should call Vercel AI generateText with prompts and return text', async () => {
    mockGenerateText.mockResolvedValue({ text: 'Generated script output' });

    const result = await service.generateText('sys prompt', 'user prompt');

    const calls = mockGenerateText.mock.calls as unknown as Array<
      [{ system: string; prompt: string }]
    >;
    expect(calls[0][0].system).toBe('sys prompt');
    expect(calls[0][0].prompt).toBe('user prompt');
    expect(result).toBe('Generated script output');
  });

  it('should throw error if DEEPSEEK_API_KEY is not configured', async () => {
    mockConfigService.get.mockReturnValue(null);

    await expect(service.generateText('sys', 'user')).rejects.toThrow(
      'DeepSeek API key is not configured',
    );
  });
});
