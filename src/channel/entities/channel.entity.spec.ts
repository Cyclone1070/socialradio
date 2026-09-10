import { Channel } from './channel.entity';

describe('ChannelEntity', () => {
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
