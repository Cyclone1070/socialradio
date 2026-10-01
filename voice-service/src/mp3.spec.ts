import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { measureMp3Seconds } from './mp3';

const FIXTURES = join(__dirname, '..', 'fixtures');

const read = (file: string): Buffer => readFileSync(join(FIXTURES, file));

/**
 * The fixtures are real output from this service, and the manifest's numbers came
 * from ffprobe when they were recorded. Holding the parser to those numbers is the
 * whole point of it existing: the duration is measured from the audio's frames, not
 * inferred from a byte count and an assumed bitrate.
 */
describe('measureMp3Seconds', () => {
  it('reports the length of a recorded turn to the millisecond', () => {
    expect(measureMp3Seconds(read('turn-en-US-GuyNeural.mp3'))).toBeCloseTo(
      2.376,
      3,
    );
    expect(measureMp3Seconds(read('turn-en-US-JennyNeural.mp3'))).toBeCloseTo(
      2.256,
      3,
    );
  });

  it('adds up when turns are concatenated', () => {
    const joined = Buffer.concat([
      read('turn-en-US-GuyNeural.mp3'),
      read('turn-en-US-JennyNeural.mp3'),
    ]);

    expect(measureMp3Seconds(joined)).toBeCloseTo(4.632, 3);
  });

  it('skips an ID3 tag in front of the audio', () => {
    const tagged = Buffer.concat([
      // 'ID3', version 3, no flags, syncsafe size of zero.
      Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
      read('turn-en-US-GuyNeural.mp3'),
    ]);

    expect(measureMp3Seconds(tagged)).toBeCloseTo(2.376, 3);
  });

  it('refuses audio it cannot read instead of guessing a length', () => {
    expect(() =>
      measureMp3Seconds(Buffer.from('definitely not audio')),
    ).toThrow(/MP3/i);
  });
});
