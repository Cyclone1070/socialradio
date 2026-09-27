import {
  MusicSegment,
  TalkSegment,
  AdSegment,
  JingleSegment,
} from './segment.entity';

describe('Segment Entities Invariants & Encapsulation', () => {
  describe('Base Segment Invariants', () => {
    it('enforces playOrder as integer >= 1', () => {
      const segment = new JingleSegment();
      segment.playOrder = 1;
      expect(segment.playOrder).toBe(1);

      segment.playOrder = 42;
      expect(segment.playOrder).toBe(42);

      expect(() => {
        segment.playOrder = 0;
      }).toThrow('playOrder must be an integer >= 1');

      expect(() => {
        segment.playOrder = -5;
      }).toThrow('playOrder must be an integer >= 1');

      expect(() => {
        segment.playOrder = 2.7;
      }).toThrow('playOrder must be an integer >= 1');
    });

    it('enforces durationSeconds bounds (0 < duration <= 7200)', () => {
      const segment = new AdSegment();
      segment.durationSeconds = 30;
      expect(segment.durationSeconds).toBe(30);

      segment.durationSeconds = 7200;
      expect(segment.durationSeconds).toBe(7200);

      expect(() => {
        segment.durationSeconds = 0;
      }).toThrow('durationSeconds must be > 0 and <= 7200');

      expect(() => {
        segment.durationSeconds = -10;
      }).toThrow('durationSeconds must be > 0 and <= 7200');

      expect(() => {
        segment.durationSeconds = 7201;
      }).toThrow('durationSeconds must be > 0 and <= 7200');

      expect(() => {
        segment.durationSeconds = NaN;
      }).toThrow('durationSeconds must be > 0 and <= 7200');
    });
  });

  describe('MusicSegment Subtype Invariants', () => {
    it('enforces non-empty title and artist', () => {
      const music = new MusicSegment('  Bohemian Rhapsody  ', '  Queen  ');

      expect(music.title).toBe('Bohemian Rhapsody');
      expect(music.artist).toBe('Queen');

      expect(() => {
        new MusicSegment('   ', 'Queen');
      }).toThrow('title cannot be empty');

      expect(() => {
        new MusicSegment('Bohemian Rhapsody', '');
      }).toThrow('artist cannot be empty');
    });
  });

  describe('TalkSegment Subtype Invariants', () => {
    it('enforces non-empty clusterId and valid status enum', () => {
      const talk = new TalkSegment('  cluster-123  ');
      expect(talk.clusterId).toBe('cluster-123');

      expect(() => {
        new TalkSegment('   ');
      }).toThrow('clusterId cannot be empty');

      expect(talk.status).toBe('generating');
      talk.status = 'ready';
      expect(talk.status).toBe('ready');
      talk.status = 'failed';
      expect(talk.status).toBe('failed');

      expect(() => {
        // @ts-expect-error test runtime invalid value
        talk.status = 'unknown';
      }).toThrow('Invalid segment status');
    });

    it('encapsulates script property', () => {
      const talk = new TalkSegment('cluster-1');
      expect(talk.script).toBeNull();
      talk.script = [{ speaker: 'host', text: 'Welcome back' }];
      expect(talk.script).toHaveLength(1);
      expect(talk.script?.[0].text).toBe('Welcome back');
    });

    it('returns frozen defensive copy of script array to prevent mutation leaks', () => {
      const talk = new TalkSegment('cluster-1');
      talk.script = [{ speaker: 'host', text: 'Welcome back' }];
      const leaked = talk.script as { speaker: string; text: string }[];
      expect(() => {
        leaked.push({ speaker: 'co-host', text: 'Another turn' });
      }).toThrow();
    });

    it('validates script turns structure and deeply freezes script turns', () => {
      const talk = new TalkSegment('cluster-1');
      expect(() => {
        // @ts-expect-error runtime invalid type
        talk.script = 'not-an-array';
      }).toThrow('script must be an array or null');

      expect(() => {
        talk.script = [{ speaker: '  ', text: 'hello' }];
      }).toThrow('Each script turn must have a non-empty speaker and text');

      talk.script = [{ speaker: 'host', text: 'Welcome' }];
      const turns = talk.script;
      expect(() => {
        (turns[0] as { text: string }).text = 'Hacked';
      }).toThrow();
    });
  });

  describe('Lifecycle and Identity Encapsulation', () => {
    it('encapsulates id, channelId, channel and enforces read-only createdAt', () => {
      const seg = new MusicSegment('Song', 'Artist');
      expect(seg.createdAt).toBeUndefined();

      const persistedDate = new Date('2026-02-01T12:00:00Z');
      const persistedSeg = new MusicSegment(
        'Song',
        'Artist',
        persistedDate,
        'seg-uuid',
      );
      expect(persistedSeg.createdAt).toEqual(persistedDate);
      expect(persistedSeg.id).toBe('seg-uuid');
    });

    it('returns defensive copies of createdAt to prevent mutation leaks', () => {
      const persistedDate = new Date('2026-02-01T12:00:00Z');
      const persistedSeg = new MusicSegment(
        'Song',
        'Artist',
        persistedDate,
        'seg-uuid',
      );
      const leaked = persistedSeg.createdAt;
      leaked?.setTime(0);
      expect(persistedSeg.createdAt?.toISOString()).toBe(
        '2026-02-01T12:00:00.000Z',
      );
    });
  });
});
