import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../infrastructure/storage/storage.service';
import { createServiceLogger } from '../infrastructure/logging/logging.module';
import { lastValueFrom } from 'rxjs';
import { VoiceContract } from '../domain/contracts';
import { ScriptData } from '../domain/types/script.types';
import { TalkData } from '../domain/types/audio.types';

export const SPEAKER_VOICE_MAP: Record<string, string> = {
  Dave: 'en-US-Neural2-J',
  Sarah: 'en-US-Neural2-F',
  Caller: 'en-US-Neural2-I',
};

export const DEFAULT_VOICE = 'en-US-Neural2-J';

@Injectable()
export class AudioService implements VoiceContract {
  private readonly logger = createServiceLogger(AudioService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
  ) {}

  getVoiceForSpeaker(speaker: string): string {
    return SPEAKER_VOICE_MAP[speaker] || DEFAULT_VOICE;
  }

  cleanSpokenText(text: string): string {
    return text
      .replace(/\[.*?\]/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async synthesizeScript(
    script: ScriptData,
    outputPath: string,
  ): Promise<TalkData> {
    const startMs = Date.now();
    const turnBuffers: Buffer[] = [];

    for (const turn of script.turns) {
      const cleaned = this.cleanSpokenText(turn.text);
      if (!cleaned) continue;
      const voice = this.getVoiceForSpeaker(turn.speaker);
      const buffer = await this.synthesizeTurn(cleaned, voice);
      turnBuffers.push(buffer);
    }

    const combinedBuffer = Buffer.concat(turnBuffers);
    await this.storageService.write({
      key: outputPath,
      content: combinedBuffer,
    });

    const durationSeconds = combinedBuffer.length / 16000;
    this.logger.info(
      {
        postId: script.postId,
        turns: script.turns.length,
        bytes: combinedBuffer.length,
        durationSeconds,
        outKey: outputPath,
        ms: Date.now() - startMs,
      },
      'Multi-speaker TTS synthesis completed',
    );

    return {
      filePath: outputPath,
      durationSeconds,
      postIds: [script.postId],
    };
  }

  async synthesizeTurn(text: string, voiceName: string): Promise<Buffer> {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    const response = await lastValueFrom(
      this.httpService.post(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
        {
          input: { text },
          voice: { languageCode: 'en-US', name: voiceName },
          audioConfig: { audioEncoding: 'MP3' },
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    interface GoogleTtsResponse {
      audioContent?: string;
    }

    const data = response.data as GoogleTtsResponse;
    if (!data.audioContent) {
      throw new Error('No audio content returned from Google TTS API');
    }

    return Buffer.from(data.audioContent, 'base64');
  }

  async generateSpeech(text: string, outputFilePath: string): Promise<number> {
    const startMs = Date.now();
    const buffer = await this.synthesizeTurn(text, DEFAULT_VOICE);
    await this.storageService.write({
      key: outputFilePath,
      content: buffer,
    });

    const durationSeconds = buffer.length / 16000;
    this.logger.info(
      {
        textChars: text.length,
        bytes: buffer.length,
        outKey: outputFilePath,
        ms: Date.now() - startMs,
      },
      'TTS synthesis',
    );
    return durationSeconds;
  }
}
