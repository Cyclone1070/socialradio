import { Channel } from './channel.entity';

describe('ChannelEntity', () => {
  describe('In-Memory OOP Invariants & Encapsulation', () => {
    it('sets and trims channel name correctly', () => {
      const channel = new Channel('  Indie Rock FM  ');
      expect(channel.name).toBe('Indie Rock FM');
    });

    it('throws error when setting empty or whitespace name', () => {
      expect(() => new Channel('')).toThrow('Channel name cannot be empty');
      expect(() => new Channel('   ')).toThrow('Channel name cannot be empty');

      const channel = new Channel('Valid');
      expect(() => {
        channel.name = '  ';
      }).toThrow('Channel name cannot be empty');
    });

    it('validates visibility values (public | private)', () => {
      const channel = new Channel('Rock', 'private');
      expect(channel.visibility).toBe('private');

      channel.visibility = 'public';
      expect(channel.visibility).toBe('public');

      expect(() => {
        // @ts-expect-error test runtime invalid value
        channel.visibility = 'secret';
      }).toThrow('Invalid visibility');
    });

    it('enforces currentPlayOrder >= 1 or null', () => {
      const channel = new Channel('Rock');
      expect(channel.currentPlayOrder).toBeNull();

      channel.currentPlayOrder = 5;
      expect(channel.currentPlayOrder).toBe(5);

      channel.currentPlayOrder = null;
      expect(channel.currentPlayOrder).toBeNull();

      expect(() => {
        channel.currentPlayOrder = 0;
      }).toThrow('currentPlayOrder must be an integer >= 1');

      expect(() => {
        channel.currentPlayOrder = -3;
      }).toThrow('currentPlayOrder must be an integer >= 1');

      expect(() => {
        channel.currentPlayOrder = 1.5;
      }).toThrow('currentPlayOrder must be an integer >= 1');
    });

    it('manages id, ownerId, currentSegmentId encapsulation', () => {
      const channel = new Channel('Jazz Radio', 'public', 'user-1', 'chan-123');
      expect(channel.ownerId).toBe('user-1');
      expect(channel.id).toBe('chan-123');

      channel.ownerId = 'user-2';
      expect(channel.ownerId).toBe('user-2');
      channel.ownerId = null;
      expect(channel.ownerId).toBeNull();

      expect(channel.currentSegmentId).toBeNull();
      channel.currentSegmentId = 'seg-abc';
      expect(channel.currentSegmentId).toBe('seg-abc');
      channel.currentSegmentId = null;
      expect(channel.currentSegmentId).toBeNull();
    });

    it('enforces read-only createdAt managed by DB without Node clock generation', () => {
      const unpersistedChannel = new Channel('Fresh FM');
      expect(unpersistedChannel.createdAt).toBeUndefined();

      const persistedDate = new Date('2026-01-01T00:00:00.000Z');
      const persistedChannel = new Channel(
        'Archived FM',
        'public',
        null,
        'chan-archived',
        persistedDate,
      );
      expect(persistedChannel.createdAt).toBe(persistedDate);
      expect(persistedChannel.id).toBe('chan-archived');
    });
  });

  describe('Cycle 2.1: Virtual Clock Properties', () => {
    it('initializes playheadStartedAt and lastActiveAt as null by default', () => {
      const channel = new Channel();
      expect(channel.playheadStartedAt).toBeNull();
      expect(channel.lastActiveAt).toBeNull();
    });

    it('allows assigning Date values to playheadStartedAt and lastActiveAt', () => {
      const channel = new Channel();
      const now = new Date();
      channel.playheadStartedAt = now;
      channel.lastActiveAt = now;

      expect(channel.playheadStartedAt).toBe(now);
      expect(channel.lastActiveAt).toBe(now);
    });
  });
});
