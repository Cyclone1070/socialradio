import { MusicTrack } from './music-track.entity';

describe('MusicTrack', () => {
  it('enforces non-empty title, artist, filePath, and durationSeconds > 0', () => {
    const track = new MusicTrack(
      '  Song  ',
      '  Artist  ',
      '  music/song.mp3  ',
      180,
    );
    expect(track.title).toBe('Song');
    expect(track.artist).toBe('Artist');
    expect(track.filePath).toBe('music/song.mp3');
    expect(track.durationSeconds).toBe(180);

    expect(() => {
      new MusicTrack('Song', 'Artist', '   ', 180);
    }).toThrow('filePath cannot be empty');

    expect(() => {
      new MusicTrack('Song', 'Artist', 'music/song.mp3', 0);
    }).toThrow('durationSeconds must be > 0');

    expect(() => {
      new MusicTrack('Song', 'Artist', 'music/song.mp3', -5);
    }).toThrow('durationSeconds must be > 0');
  });

  it('manages id and enforces read-only createdAt', () => {
    const track = new MusicTrack('Song', 'Artist', 'music/song.mp3', 180);
    expect(track.createdAt).toBeUndefined();

    const persistedDate = new Date('2026-01-01T00:00:00Z');
    const persisted = new MusicTrack(
      'Song',
      'Artist',
      'music/song.mp3',
      180,
      'track-1',
      persistedDate,
    );
    expect(persisted.createdAt).toEqual(persistedDate);
    expect(persisted.id).toBe('track-1');

    const leaked = track.createdAt;
    leaked?.setTime(0);
    expect(track.createdAt).toBeUndefined();
  });
});
