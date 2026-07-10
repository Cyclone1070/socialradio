import { Injectable, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import type { StorageService } from '../domain/types/storage.interface';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class AudioService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @Inject('StorageService')
    private readonly storageService: StorageService,
  ) {}

  async generateSpeech(text: string, outputFilePath: string): Promise<number> {
    const apiKey = this.configService.get<string>('TTS_API_KEY');
    if (!apiKey) {
      throw new Error('TTS API key is not configured');
    }

    const response = await lastValueFrom(
      this.httpService.post(
        'https://api.openai.com/v1/audio/speech',
        {
          model: 'tts-1',
          input: text,
          voice: 'alloy',
          response_format: 'mp3',
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer', // Ensure we receive a binary buffer
        },
      ),
    );

    const buffer = Buffer.from(response.data);
    await this.storageService.write(outputFilePath, buffer);

    // 128kbps CBR MP3 math: 128,000 bits/sec = 16,000 bytes/sec
    const durationSeconds = buffer.length / 16000;
    return durationSeconds;
  }
}
