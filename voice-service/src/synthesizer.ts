import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { measureMp3Seconds } from './mp3';
import { NothingToSpeakError, Track, Turn } from './types';
import { cleanSpokenText, voiceForSpeaker } from './voices';

export type TurnToAudio = (text: string, voice: string) => Promise<Buffer>;

/**
 * One turn through the engine. Retried because the endpoint drops connections,
 * which is a transport hiccup and not a reason to lose a whole segment.
 */
export async function synthesizeTurnWithLibrary(
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
        audioStream.on('error', (err: Error) => reject(err));
      });
      return Buffer.concat(chunks);
    } catch (err) {
      if (attempt > retries) throw err;
      await new Promise((res) => setTimeout(res, 500 * attempt));
    }
  }
  throw new Error('TTS turn synthesis failed');
}

/**
 * A whole script into one track: cast each speaker, strip what should not be read
 * aloud, speak the turns in order, then measure the audio that came out.
 */
export async function synthesizeTrack(
  turns: Turn[],
  turnToAudio: TurnToAudio = synthesizeTurnWithLibrary,
): Promise<Track> {
  const spoken = turns
    .map((turn) => ({
      voice: voiceForSpeaker(turn.speaker),
      text: cleanSpokenText(turn.text),
    }))
    .filter((turn) => turn.text.length > 0);

  // Nothing to speak - no turns at all, or every turn was stage direction.
  // Answering with silence would put a zero-length segment in the stream.
  if (spoken.length === 0) {
    throw new NothingToSpeakError('script has no turns to speak');
  }

  const chunks: Buffer[] = [];
  for (const turn of spoken) {
    chunks.push(await turnToAudio(turn.text, turn.voice));
  }

  const audio = Buffer.concat(chunks);
  return { audio, seconds: measureMp3Seconds(audio) };
}
