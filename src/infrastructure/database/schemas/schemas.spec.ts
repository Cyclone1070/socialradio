import { ChannelSchema, SegmentSchema } from './channel.schema';
import { MusicTrackSchema, AdTrackSchema, JingleSchema } from './media.schema';
import { SubredditSchema } from './content.schema';
import { UserSchema } from './user.schema';
import * as allSchemas from './index';

describe('EntitySchema Database Constraint Specifications', () => {
  describe('Accessor coverage', () => {
    it('routes every persisted scalar property through its entity accessors', () => {
      const offenders: string[] = [];

      for (const schema of Object.values(allSchemas)) {
        const meta = schema.meta as {
          className: string;
          class: { prototype: object };
          properties: Record<
            string,
            { kind?: unknown; accessor?: unknown } | undefined
          >;
        };

        for (const [name, prop] of Object.entries(meta.properties)) {
          if (!prop || prop.kind !== undefined || prop.accessor) {
            continue;
          }

          const descriptor = Object.getOwnPropertyDescriptor(
            meta.class.prototype,
            name,
          );
          if (descriptor?.get && descriptor?.set) {
            offenders.push(`${meta.className}.${name}`);
          }
        }
      }

      expect(offenders).toEqual([]);
    });
  });

  describe('ChannelSchema', () => {
    it('defines non-empty name, visibility enum, and positive play order checks', () => {
      const checkNames = (ChannelSchema.meta.checks ?? []).map((c) => c.name);
      expect(checkNames).toContain('channel_name_not_empty');
      expect(checkNames).toContain('channel_visibility_check');
      expect(checkNames).toContain('channel_play_order_positive');
    });

    it('configures foreign key mappings for ownerId and currentSegmentId', () => {
      const props = ChannelSchema.meta.properties;
      expect(props.name.accessor).toBe(true);
      expect(props.visibility.accessor).toBe(true);
      expect(props.currentPlayOrder.accessor).toBe(true);
      expect(props.id.accessor).toBe(true);
      expect(props.createdAt.accessor).toBe(true);

      expect(props.ownerId.kind).toBe('m:1');
      expect(props.ownerId.mapToPk).toBe(true);
      expect(props.ownerId.deleteRule).toBe('set null');

      expect(props.currentSegmentId.kind).toBe('m:1');
      expect(props.currentSegmentId.mapToPk).toBe(true);
      expect(props.currentSegmentId.deleteRule).toBe('set null');
    });
  });

  describe('SegmentSchema', () => {
    it('defines checks for play order, duration bounds, type, status, and subtype invariants', () => {
      const checkNames = (SegmentSchema.meta.checks ?? []).map((c) => c.name);
      expect(checkNames).toContain('segment_play_order_positive');
      expect(checkNames).toContain('segment_duration_bounds');
      expect(checkNames).toContain('segment_type_check');
      expect(checkNames).toContain('segment_status_check');
      expect(checkNames).toContain('segment_music_subtype_check');
      expect(checkNames).toContain('segment_talk_subtype_check');

      const props = SegmentSchema.meta.properties;
      expect(props.id.accessor).toBe(true);
      expect(props.playOrder.accessor).toBe(true);
      expect(props.durationSeconds.accessor).toBe(true);
      expect(props.createdAt.accessor).toBe(true);
    });

    it('enforces unique compound index on (channelId, playOrder)', () => {
      const uniques = SegmentSchema.meta.uniques ?? [];
      const hasChannelPlayOrder = uniques.some((u) => {
        const props = Array.isArray(u.properties)
          ? u.properties
          : [u.properties];
        return props.includes('channelId') && props.includes('playOrder');
      });
      expect(hasChannelPlayOrder).toBe(true);
    });
  });

  describe('MediaTrack Schemas', () => {
    it('enforces positive duration check and unique filePath on MusicTrackSchema', () => {
      const checkNames = (MusicTrackSchema.meta.checks ?? []).map(
        (c) => c.name,
      );
      expect(checkNames).toContain('music_track_duration_positive');
      expect(MusicTrackSchema.meta.properties.filePath.unique).toBe(true);
      expect(MusicTrackSchema.meta.properties.id.accessor).toBe(true);
      expect(MusicTrackSchema.meta.properties.title.accessor).toBe(true);
      expect(MusicTrackSchema.meta.properties.artist.accessor).toBe(true);
      expect(MusicTrackSchema.meta.properties.filePath.accessor).toBe(true);
      expect(MusicTrackSchema.meta.properties.durationSeconds.accessor).toBe(
        true,
      );
      expect(MusicTrackSchema.meta.properties.createdAt.accessor).toBe(true);
    });

    it('enforces positive duration check and unique filePath on AdTrackSchema', () => {
      const checkNames = (AdTrackSchema.meta.checks ?? []).map((c) => c.name);
      expect(checkNames).toContain('ad_track_duration_positive');
      expect(AdTrackSchema.meta.properties.filePath.unique).toBe(true);
      expect(AdTrackSchema.meta.properties.id.accessor).toBe(true);
      expect(AdTrackSchema.meta.properties.advertiser.accessor).toBe(true);
      expect(AdTrackSchema.meta.properties.filePath.accessor).toBe(true);
      expect(AdTrackSchema.meta.properties.durationSeconds.accessor).toBe(true);
      expect(AdTrackSchema.meta.properties.createdAt.accessor).toBe(true);
    });

    it('enforces positive duration check and unique filePath on JingleSchema', () => {
      const checkNames = (JingleSchema.meta.checks ?? []).map((c) => c.name);
      expect(checkNames).toContain('jingle_duration_positive');
      expect(JingleSchema.meta.properties.filePath.unique).toBe(true);
      expect(JingleSchema.meta.properties.id.accessor).toBe(true);
      expect(JingleSchema.meta.properties.name.accessor).toBe(true);
      expect(JingleSchema.meta.properties.filePath.accessor).toBe(true);
      expect(JingleSchema.meta.properties.durationSeconds.accessor).toBe(true);
      expect(JingleSchema.meta.properties.createdAt.accessor).toBe(true);
    });
  });

  describe('Content & User Schemas', () => {
    it('enforces non-empty name check on SubredditSchema', () => {
      const checkNames = (SubredditSchema.meta.checks ?? []).map((c) => c.name);
      expect(checkNames).toContain('subreddit_name_not_empty');
      expect(SubredditSchema.meta.properties.name.accessor).toBe(true);
      expect(SubredditSchema.meta.properties.id.accessor).toBe(true);
      expect(SubredditSchema.meta.properties.createdAt.accessor).toBe(true);
    });

    it('enforces user role enum check on UserSchema', () => {
      const checkNames = (UserSchema.meta.checks ?? []).map((c) => c.name);
      expect(checkNames).toContain('user_role_check');
      expect(UserSchema.meta.properties.email.accessor).toBe(true);
      expect(UserSchema.meta.properties.role.accessor).toBe(true);
      expect(UserSchema.meta.properties.id.accessor).toBe(true);
      expect(UserSchema.meta.properties.createdAt.accessor).toBe(true);
    });

    it('maps the user password hash through its private field and hides it', () => {
      const prop = UserSchema.meta.properties.passwordHash;
      expect(prop.accessor).toBe('_passwordHash');
      expect(prop).toMatchObject({ fieldName: 'password_hash' });
      expect(prop.hidden).toBe(true);
    });
  });
});
