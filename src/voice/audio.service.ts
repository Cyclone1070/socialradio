import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../infrastructure/storage/storage.service';
import { createServiceLogger } from '../infrastructure/logging/logging.module';
import { VoiceContract } from '../domain/contracts';
import { ScriptData } from '../domain/types/script.types';
import { TalkData } from '../domain/types/audio.types';

/**
 * The app's side of the voice boundary: send the script, store the audio that comes
 * back, keep the length the service measured for it.
 *
 * Nothing here knows about voices, formats, concatenation or bitrates - all of that
 * is the service's business. Swapping speech engines means pointing
 * VOICE_SERVICE_URL at a different service, with no change to this file or to any
 * caller.
 */
@Injectable()
export class AudioService implements VoiceContract {
  private readonly logger = createServiceLogger(AudioService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
  ) {}

  async synthesizeScript(
    script: ScriptData,
    outputPath: string,
  ): Promise<TalkData> {
    const baseUrl = this.configService.get<string>('VOICE_SERVICE_URL');
    if (!baseUrl) {
      throw new Error('VOICE_SERVICE_URL is not configured');
    }

    const startMs = Date.now();
    const response = await fetch(`${baseUrl}/synthesize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(script),
    });

    if (!response.ok) {
      throw new Error(
        `voice service answered ${response.status} for a ${script.turns.length}-turn script`,
      );
    }

    const reported = response.headers.get('x-duration-seconds');
    const durationSeconds = Number(reported);
    // The queue advances its playhead by this number, so a missing or unreadable
    // one is refused here rather than stored as NaN against a real track.
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error(
        `voice service reported an unusable duration: ${reported}`,
      );
    }

    const audio = Buffer.from(await response.arrayBuffer());
    await this.storageService.write({ key: outputPath, content: audio });

    this.logger.info(
      {
        postId: script.postId,
        turns: script.turns.length,
        bytes: audio.length,
        durationSeconds,
        outKey: outputPath,
        ms: Date.now() - startMs,
      },
      'Voice track received from the voice service',
    );

    return {
      filePath: outputPath,
      durationSeconds,
      postIds: [script.postId],
    };
  }
}
