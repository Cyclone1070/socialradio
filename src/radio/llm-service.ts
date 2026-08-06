export abstract class LlmService {
  abstract generateText(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string>;
}
