import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateText, LanguageModel } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';

@Injectable()
export class LlmService {
  constructor(private readonly configService: ConfigService) {}

  private getLanguageModel(): LanguageModel {
    const apiKey = this.configService.get<string>('LLM_API_KEY');
    if (!apiKey) {
      throw new Error('LLM API key is not configured (set LLM_API_KEY)');
    }

    const rawBaseUrl = this.configService.get<string>('LLM_BASE_URL');
    if (!rawBaseUrl) {
      throw new Error('LLM base URL is not configured (set LLM_BASE_URL)');
    }
    const baseUrl = rawBaseUrl.endsWith('/')
      ? rawBaseUrl.slice(0, -1)
      : rawBaseUrl;

    const modelName = this.configService.get<string>('LLM_MODEL');
    if (!modelName) {
      throw new Error('LLM model name is not configured (set LLM_MODEL)');
    }

    const deepseek = createDeepSeek({
      apiKey,
      baseURL: baseUrl,
    });
    return deepseek(modelName);
  }

  async generateText(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    const { text } = await generateText({
      model: this.getLanguageModel(),
      system: systemPrompt,
      prompt: userPrompt,
    });
    return text;
  }
}
