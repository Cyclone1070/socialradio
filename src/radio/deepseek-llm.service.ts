import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { LlmService } from './interfaces/llm-service.interface';

@Injectable()
export class DeepSeekLlmService implements LlmService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async generateText(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    if (!apiKey) {
      throw new Error('DeepSeek API key is not configured');
    }

    const defaultBaseUrl = 'https://api.deepseek.com/v1';
    const rawBaseUrl =
      this.configService.get<string>('DEEPSEEK_BASE_URL') || defaultBaseUrl;

    // Normalize base URL: strip trailing slash
    const baseUrl = rawBaseUrl.endsWith('/')
      ? rawBaseUrl.slice(0, -1)
      : rawBaseUrl;
    const model =
      this.configService.get<string>('DEEPSEEK_MODEL') || 'deepseek-chat';

    const response = await lastValueFrom(
      this.httpService.post(
        `${baseUrl}/chat/completions`,
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          stream: false,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    interface DeepSeekResponse {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    }

    const data = response.data as DeepSeekResponse;
    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error('No text returned from DeepSeek API');
    }

    return text;
  }
}
