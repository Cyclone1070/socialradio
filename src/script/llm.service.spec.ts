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
    get: jest.fn((key: string): string | null => {
      if (key === 'LLM_API_KEY') return 'test-key';
      if (key === 'LLM_BASE_URL') return 'https://opencode.ai/zen/v1';
      if (key === 'LLM_MODEL') return 'deepseek-chat';
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

  it('should throw error if LLM API key is not configured', async () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'LLM_API_KEY') return null;
      return 'val';
    });

    await expect(service.generateText('sys', 'user')).rejects.toThrow(
      'LLM API key is not configured (set LLM_API_KEY)',
    );
  });

  it('should throw error if LLM base URL is not configured', async () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'LLM_BASE_URL') return null;
      return 'val';
    });

    await expect(service.generateText('sys', 'user')).rejects.toThrow(
      'LLM base URL is not configured (set LLM_BASE_URL)',
    );
  });

  it('should throw error if LLM model name is not configured', async () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'LLM_MODEL') return null;
      return 'val';
    });

    await expect(service.generateText('sys', 'user')).rejects.toThrow(
      'LLM model name is not configured (set LLM_MODEL)',
    );
  });
});
