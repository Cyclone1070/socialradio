import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';
import * as aiModule from 'ai';

jest.mock('ai', () => ({
  streamText: jest.fn(),
  generateText: jest.fn(),
}));

jest.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: jest.fn(() => jest.fn(() => ({}))),
}));

describe('LlmService', () => {
  let service: LlmService;

  const mockStreamText = aiModule.streamText as jest.Mock<any>;

  // Named so it can be re-installed in beforeEach: several tests override it,
  // and jest.clearAllMocks() does not clear implementations, so an override
  // would otherwise leak into every test that follows.
  const defaultConfigGet = (key: string): string | null => {
    if (key === 'LLM_API_KEY') return 'test-key';
    if (key === 'LLM_BASE_URL') return 'https://opencode.ai/zen/v1';
    if (key === 'LLM_MODEL') return 'deepseek-chat';
    return null;
  };

  const mockConfigService = {
    get: jest.fn(defaultConfigGet),
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
    mockConfigService.get.mockImplementation(defaultConfigGet);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should stream text via streamText with firstChunkMs, chunkMs, and totalMs timeouts', async () => {
    async function* fakeStream() {
      await Promise.resolve();
      yield 'Chunk 1, ';
      yield 'Chunk 2.';
    }

    mockStreamText.mockReturnValue({
      textStream: fakeStream(),
    });

    const result = await service.generateText('sys prompt', 'user prompt');

    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'sys prompt',
        prompt: 'user prompt',
        timeout: {
          firstChunkMs: 30000,
          chunkMs: 15000,
          totalMs: 300000,
        },
      }),
    );
    expect(result).toBe('Chunk 1, Chunk 2.');
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

  it('should surface a provider error instead of returning an empty script', async () => {
    // The AI SDK does not throw from streamText: it reports the failure through
    // onError and ends the stream. That is how a retired model silently became
    // a zero-character script during playback.
    mockStreamText.mockImplementation(
      (options: { onError?: (event: { error: unknown }) => void }) => {
        options.onError?.({ error: new Error('Model is unavailable') });
        return {
          textStream: (function* generate() {
            yield '';
          })(),
        };
      },
    );

    await expect(service.generateText('sys', 'user')).rejects.toThrow(
      'Model is unavailable',
    );
  });
});
