/**
 * Records the audio the Tier 1 mock replays, from the real speech engine.
 *
 * Two kinds of recording, both measured by ffprobe rather than by our own parser:
 *   - one turn per speaker, which the service's unit tests hold the frame-based
 *     duration parser to;
 *   - one whole track, which the mock answers /synthesize with, along with the
 *     length ffprobe measured for it.
 *
 * The library is free and keyless, so re-recording is just running this file:
 *   npx ts-node --transpile-only deployment/tests/tools/record-voice-fixtures.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { synthesizeTurnWithLibrary } from '../../../voice-service/src/synthesizer';
import { SPEAKER_VOICE_MAP } from '../../../voice-service/src/voices';

const OUT_DIR = join(__dirname, '..', '..', '..', 'voice-service', 'fixtures');

/** One short turn per speaker, so concatenating two different files is exercised. */
const TURNS = [
  { speaker: 'Dave', text: 'Welcome back to the show.' },
  { speaker: 'Sarah', text: 'Glad to be here tonight.' },
];

const measureSeconds = (file: string): number => {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  ).trim();
  const seconds = Number(out);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe could not measure ${file}: ${JSON.stringify(out)}`);
  }
  return seconds;
};

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const manifest: {
    note: string;
    turns: {
      speaker: string;
      voice: string;
      text: string;
      file: string;
      bytes: number;
      seconds: number;
    }[];
    totalSeconds: number;
  } = {
    note: 'Recorded from the real speech engine by deployment/tests/tools/record-voice-fixtures.ts. seconds is measured with ffprobe, never derived by the decoder under test.',
    turns: [],
    totalSeconds: 0,
  };

  const chunks = [];
  for (const turn of TURNS) {
    const voice = SPEAKER_VOICE_MAP[turn.speaker];
    if (!voice) throw new Error(`no voice mapped for ${turn.speaker}`);

    const audio = await synthesizeTurnWithLibrary(turn.text, voice);
    const file = `turn-${voice}.mp3`;
    writeFileSync(join(OUT_DIR, file), audio);
    chunks.push(audio);

    const seconds = measureSeconds(join(OUT_DIR, file));
    manifest.turns.push({
      speaker: turn.speaker,
      voice,
      text: turn.text,
      file,
      bytes: audio.length,
      seconds,
    });
    manifest.totalSeconds += seconds;
    manifest.totalSeconds = Number(manifest.totalSeconds.toFixed(3));
    process.stdout.write(
      `recorded ${file}: ${audio.length} bytes, ${seconds}s\n`,
    );
  }

  writeFileSync(
    join(OUT_DIR, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  // The mock answers any script with this track, so the app's side of the boundary
  // is exercised end to end while the audio itself stays pregenerated.
  const track = Buffer.concat(chunks);
  writeFileSync(join(OUT_DIR, 'track.mp3'), track);
  const trackSeconds = measureSeconds(join(OUT_DIR, 'track.mp3'));
  writeFileSync(
    join(OUT_DIR, 'track.json'),
    `${JSON.stringify(
      {
        note: 'Answered by the Tier 1 voice mock for any script. seconds is ffprobe, measured from track.mp3.',
        file: 'track.mp3',
        bytes: track.length,
        seconds: trackSeconds,
      },
      null,
      2,
    )}\n`,
  );

  process.stdout.write(
    `recorded track.mp3: ${track.length} bytes, ${trackSeconds}s (the mock answers /synthesize with this)\n`,
  );
}

void main();
