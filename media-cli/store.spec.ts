import { Jingle } from '../src/media/entities/jingle.entity';
import { Liner } from '../src/media/entities/liner.entity';
import { MusicTrack } from '../src/media/entities/music-track.entity';
import { entryOf } from './store';

describe('entryOf', () => {
  it('reads a stored song back the way the manifest describes it', () => {
    const track = new MusicTrack(
      'Neon Waves',
      'The Static',
      'music/neon-waves-8f2a1c.mp3',
      214.5,
    );

    expect(entryOf(track)).toEqual({
      kind: 'music',
      key: 'music/neon-waves-8f2a1c.mp3',
      durationSeconds: 214.5,
      title: 'Neon Waves',
      artist: 'The Static',
    });
  });

  it('reads a stored liner and a stored jingle back as themselves', () => {
    const liner = new Liner(
      "We'll be right back after this.",
      'liners/we-ll-be-right-back-4b1e9d.mp3',
      4.8,
    );
    const jingle = new Jingle(
      'Station ID',
      'jingles/station-id-77c0aa.mp3',
      6.1,
    );

    expect(entryOf(liner)).toEqual({
      kind: 'liner',
      key: 'liners/we-ll-be-right-back-4b1e9d.mp3',
      durationSeconds: 4.8,
      text: "We'll be right back after this.",
    });
    expect(entryOf(jingle)).toEqual({
      kind: 'jingle',
      key: 'jingles/station-id-77c0aa.mp3',
      durationSeconds: 6.1,
      name: 'Station ID',
    });
  });
});
