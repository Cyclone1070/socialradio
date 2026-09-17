import { MusicTrack } from './music-track.entity';
import { AdTrack } from './ad-track.entity';
import { Jingle } from './jingle.entity';

describe('Media Track Entities Invariants & Encapsulation', () => {
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
      expect(persisted.createdAt).toBe(persistedDate);
      expect(persisted.id).toBe('track-1');
    });
  });

  describe('AdTrack', () => {
    it('enforces non-empty advertiser, filePath, and durationSeconds > 0', () => {
      const ad = new AdTrack('  Acme Corp  ', '  ads/acme.mp3  ', 30);
      expect(ad.advertiser).toBe('Acme Corp');
      expect(ad.filePath).toBe('ads/acme.mp3');
      expect(ad.durationSeconds).toBe(30);

      expect(() => {
        new AdTrack('   ', 'ads/acme.mp3', 30);
      }).toThrow('advertiser cannot be empty');

      expect(() => {
        new AdTrack('Acme Corp', 'ads/acme.mp3', -1);
      }).toThrow('durationSeconds must be > 0');
    });

    it('manages id and enforces read-only createdAt', () => {
      const ad = new AdTrack('Acme', 'ads/acme.mp3', 30);
      expect(ad.createdAt).toBeUndefined();

      const persistedDate = new Date('2026-01-01T00:00:00Z');
      const persisted = new AdTrack(
        'Acme',
        'ads/acme.mp3',
        30,
        'ad-1',
        persistedDate,
      );
      expect(persisted.createdAt).toBe(persistedDate);
      expect(persisted.id).toBe('ad-1');
    });
  });

  describe('Jingle', () => {
    it('enforces non-empty name, filePath, and durationSeconds > 0', () => {
      const jingle = new Jingle('  Station ID  ', '  jingles/id.mp3  ', 10);
      expect(jingle.name).toBe('Station ID');
      expect(jingle.filePath).toBe('jingles/id.mp3');
      expect(jingle.durationSeconds).toBe(10);

      expect(() => {
        new Jingle('   ', 'jingles/id.mp3', 10);
      }).toThrow('name cannot be empty');

      expect(() => {
        new Jingle('Station ID', 'jingles/id.mp3', 0);
      }).toThrow('durationSeconds must be > 0');
    });

    it('manages id and enforces read-only createdAt', () => {
      const jingle = new Jingle('ID', 'jingles/id.mp3', 10);
      expect(jingle.createdAt).toBeUndefined();

      const persistedDate = new Date('2026-01-01T00:00:00Z');
      const persisted = new Jingle(
        'ID',
        'jingles/id.mp3',
        10,
        'jingle-1',
        persistedDate,
      );
      expect(persisted.createdAt).toBe(persistedDate);
      expect(persisted.id).toBe('jingle-1');
    });
  });
});
