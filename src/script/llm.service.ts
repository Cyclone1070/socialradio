import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateText, LanguageModel } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';

@Injectable()
export class LlmService {
  constructor(private readonly configService: ConfigService) {}

  private getLanguageModel(): LanguageModel {
    const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    if (!apiKey) {
      throw new Error('DeepSeek API key is not configured');
    }

    const defaultBaseUrl = 'https://api.deepseek.com/v1';
    const rawBaseUrl =
      this.configService.get<string>('DEEPSEEK_BASE_URL') || defaultBaseUrl;
    const baseUrl = rawBaseUrl.endsWith('/')
      ? rawBaseUrl.slice(0, -1)
      : rawBaseUrl;
    const modelName =
      this.configService.get<string>('DEEPSEEK_MODEL') || 'deepseek-chat';

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
