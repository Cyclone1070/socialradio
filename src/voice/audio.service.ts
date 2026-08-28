import { Injectable } from '@nestjs/common';
import { StorageService } from '../infrastructure/storage/storage.service';
import { createServiceLogger } from '../infrastructure/logging/logging.module';
import { VoiceContract } from '../domain/contracts';
import { ScriptData } from '../domain/types/script.types';
import { TalkData } from '../domain/types/audio.types';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

export const SPEAKER_VOICE_MAP: Record<string, string> = {
  Dave: 'en-US-GuyNeural',
  Sarah: 'en-US-JennyNeural',
  Caller: 'en-AU-NatashaNeural',
};

export const DEFAULT_VOICE = 'en-US-GuyNeural';

@Injectable()
export class AudioService implements VoiceContract {
  private readonly logger = createServiceLogger(AudioService.name);

  constructor(private readonly storageService: StorageService) {}

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
    process.stderr.write(
      `[AudioService] Starting multi-speaker TTS synthesis for ${script.turns.length} turns...\n`,
    );

    const validTurns = script.turns
      .map((turn) => ({
        ...turn,
        cleaned: this.cleanSpokenText(turn.text),
      }))
      .filter((t) => t.cleaned.length > 0);

    process.stderr.write(
      `[AudioService] Synthesizing ${validTurns.length} turns with Microsoft Edge Neural TTS...\n`,
    );
    const turnBuffers: Buffer[] = [];
    for (const turn of validTurns) {
      const voice = this.getVoiceForSpeaker(turn.speaker);
      const buf = await this.synthesizeTurn(turn.cleaned, voice);
      turnBuffers.push(buf);
    }
    process.stderr.write(
      `[AudioService] All ${turnBuffers.length} turns synthesized successfully! Concat & upload to MinIO...\n`,
    );

    const combinedBuffer = Buffer.concat(turnBuffers);
    await this.storageService.write({
      key: outputPath,
      content: combinedBuffer,
    });
    process.stderr.write(
      `[AudioService] Uploaded ${combinedBuffer.length} bytes to ${outputPath}!\n`,
    );

    const durationSeconds = combinedBuffer.length / 6000;
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

  async synthesizeTurn(
    text: string,
    voiceName: string,
    retries = 2,
  ): Promise<Buffer> {
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        const tts = new MsEdgeTTS();
        await tts.setMetadata(
          voiceName,
          OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
        );
        const { audioStream } = tts.toStream(text);
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
          audioStream.on('end', () => resolve());
          audioStream.on('error', (err) => reject(err));
        });
        return Buffer.concat(chunks);
      } catch (err) {
        if (attempt > retries) throw err;
        await new Promise((res) => setTimeout(res, 500 * attempt));
      }
    }
    throw new Error('TTS turn synthesis failed');
  }

  async generateSpeech(text: string, outputFilePath: string): Promise<number> {
    const startMs = Date.now();
    const buffer = await this.synthesizeTurn(text, DEFAULT_VOICE);
    await this.storageService.write({
      key: outputFilePath,
      content: buffer,
    });

    const durationSeconds = buffer.length / 6000;
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
