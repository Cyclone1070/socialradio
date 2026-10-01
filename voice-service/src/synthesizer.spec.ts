import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { synthesizeTrack } from './synthesizer';

const FIXTURES = join(__dirname, '..', 'fixtures');
const dave = (): Buffer =>
  readFileSync(join(FIXTURES, 'turn-en-US-GuyNeural.mp3'));
const sarah = (): Buffer =>
  readFileSync(join(FIXTURES, 'turn-en-US-JennyNeural.mp3'));

describe('synthesizeTrack', () => {
  it('speaks every turn in order, cast per speaker, and measures what it produced', async () => {
    const spoken: { text: string; voice: string }[] = [];
    const track = await synthesizeTrack(
      [
        { speaker: 'Dave', text: '[laughs] Welcome back.' },
        { speaker: 'Sarah', text: 'Glad to be here.' },
      ],
      (text, voice) => {
        spoken.push({ text, voice });
        return Promise.resolve(spoken.length === 1 ? dave() : sarah());
      },
    );

    // Stage directions stripped before they reach a voice, and the persona cast.
    expect(spoken).toEqual([
      { text: 'Welcome back.', voice: 'en-US-GuyNeural' },
      { text: 'Glad to be here.', voice: 'en-US-JennyNeural' },
    ]);
    expect(track.audio.length).toBe(dave().length + sarah().length);
    // The fixtures are real audio that ffprobe measured at 4.632s together.
    expect(track.seconds).toBeCloseTo(4.632, 3);
  });

  it('drops a turn that is nothing but stage direction', async () => {
    const spoken: string[] = [];
    await synthesizeTrack(
      [
        { speaker: 'Dave', text: '(long pause)' },
        { speaker: 'Sarah', text: 'Still here.' },
      ],
      (text) => {
        spoken.push(text);
        return Promise.resolve(sarah());
      },
    );

    expect(spoken).toEqual(['Still here.']);
  });

  it('refuses a script with nothing to speak instead of returning silence', async () => {
    await expect(
      synthesizeTrack([{ speaker: 'Dave', text: '[sighs]' }], () =>
        Promise.resolve(dave()),
      ),
    ).rejects.toThrow(/no turns/i);
  });
});
