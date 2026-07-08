import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { LlmService } from './llm.service';
import { ConfigService } from '@nestjs/config';

describe('LlmService', () => {
  let service: LlmService;

  const mockHttpService = {
    post: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'GEMINI_API_KEY') return 'mock_gemini_key';
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<LlmService>(LlmService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateText', () => {
    it('should call Gemini API and return generated text', async () => {
      const apiResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Here is your radio script.' }],
            },
          },
        ],
      };

      const response: AxiosResponse = {
        data: apiResponse,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      };

      mockHttpService.post.mockReturnValue(of(response));

      const result = await service.generateText(
        'You are an editor.',
        'Write a news script about bananas.',
      );

      expect(mockHttpService.post).toHaveBeenCalledWith(
        expect.stringContaining(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
        ),
        expect.objectContaining({
          contents: expect.any(Array) as unknown,
          systemInstruction: expect.any(Object) as unknown,
        }) as unknown,
        expect.any(Object) as unknown,
      );
      expect(result).toBe('Here is your radio script.');
    });
  });
});
