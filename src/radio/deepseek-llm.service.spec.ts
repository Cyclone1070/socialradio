import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { DeepSeekLlmService } from './deepseek-llm.service';
import { ConfigService } from '@nestjs/config';

describe('DeepSeekLlmService', () => {
  let service: DeepSeekLlmService;

  const mockHttpService = {
    post: jest.fn(),
  };

  const mockConfigValues: Record<string, string> = {
    DEEPSEEK_API_KEY: 'mock_deepseek_key',
  };

  const mockConfigService = {
    get: jest.fn((key: string) => mockConfigValues[key] || null),
  };

  beforeEach(async () => {
    mockConfigValues['DEEPSEEK_API_KEY'] = 'mock_deepseek_key';
    delete mockConfigValues['DEEPSEEK_BASE_URL'];
    delete mockConfigValues['DEEPSEEK_MODEL'];

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeepSeekLlmService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<DeepSeekLlmService>(DeepSeekLlmService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateText', () => {
    it('should post to default DeepSeek chat completions using default endpoint and model', async () => {
      const response: AxiosResponse = {
        data: {
          choices: [
            {
              message: {
                content: 'Generated script output text from DeepSeek',
              },
            },
          ],
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      };

      mockHttpService.post.mockReturnValue(of(response));

      const result = await service.generateText(
        'System rules prompt',
        'User request prompt',
      );

      expect(mockConfigService.get).toHaveBeenCalledWith('DEEPSEEK_BASE_URL');
      expect(mockConfigService.get).toHaveBeenCalledWith('DEEPSEEK_MODEL');
      expect(mockHttpService.post).toHaveBeenCalledWith(
        'https://api.deepseek.com/v1/chat/completions',
        expect.objectContaining({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: 'System rules prompt' },
            { role: 'user', content: 'User request prompt' },
          ],
          stream: false,
        }),
        expect.any(Object),
      );
      expect(result).toBe('Generated script output text from DeepSeek');
    });

    it('should post to custom base URL and model if configured in environment', async () => {
      mockConfigValues['DEEPSEEK_BASE_URL'] = 'https://opencode.ai/zen/go/v1';
      mockConfigValues['DEEPSEEK_MODEL'] = 'opencode/deepseek-chat';

      const response: AxiosResponse = {
        data: {
          choices: [
            {
              message: {
                content: 'Custom OpenCode output text',
              },
            },
          ],
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      };

      mockHttpService.post.mockReturnValue(of(response));

      const result = await service.generateText(
        'System rules prompt',
        'User request prompt',
      );

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'https://opencode.ai/zen/go/v1/chat/completions',
        expect.objectContaining({
          model: 'opencode/deepseek-chat',
          messages: [
            { role: 'system', content: 'System rules prompt' },
            { role: 'user', content: 'User request prompt' },
          ],
          stream: false,
        }),
        expect.any(Object),
      );
      expect(result).toBe('Custom OpenCode output text');
    });

    it('should throw error if DEEPSEEK_API_KEY is not configured', async () => {
      delete mockConfigValues['DEEPSEEK_API_KEY'];
      await expect(
        service.generateText('System rules', 'User request'),
      ).rejects.toThrow('DeepSeek API key is not configured');
    });
  });
});
