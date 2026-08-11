import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage/storage.service';
import { createServiceLogger } from '../logging/logging.module';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class AudioService {
  private readonly logger = createServiceLogger(AudioService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
  ) {}

  async generateSpeech(text: string, outputFilePath: string): Promise<number> {
    const startMs = Date.now();
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    const response = await lastValueFrom(
      this.httpService.post(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
        {
          input: { text },
          voice: { languageCode: 'en-US', name: 'en-US-Studio-O' },
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

    const buffer = Buffer.from(data.audioContent, 'base64');
    await this.storageService.write({
      key: outputFilePath,
      content: buffer,
    });

    // 128kbps CBR MP3 math: 128,000 bits/sec = 16,000 bytes/sec
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
