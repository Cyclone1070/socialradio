export interface LlmService {
  generateText(systemPrompt: string, userPrompt: string): Promise<string>;
}
