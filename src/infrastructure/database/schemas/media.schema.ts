import { EntitySchema } from '@mikro-orm/core';
import { MusicTrack } from '../../../media/entities/music-track.entity';
import { AdTrack } from '../../../media/entities/ad-track.entity';
import { Jingle } from '../../../media/entities/jingle.entity';

export const MusicTrackSchema = new EntitySchema<MusicTrack>({
  class: MusicTrack,
  tableName: 'music_track',
  properties: {
    id: { type: 'uuid', primary: true, defaultRaw: 'gen_random_uuid()' },
    title: { type: 'string' },
    artist: { type: 'string' },
    filePath: { type: 'string' },
    durationSeconds: { type: 'float' },
    createdAt: {
      type: 'Date',
      onCreate: () => new Date(),
      defaultRaw: 'now()',
    },
  },
});

export const AdTrackSchema = new EntitySchema<AdTrack>({
  class: AdTrack,
  tableName: 'ad_track',
  properties: {
    id: { type: 'uuid', primary: true, defaultRaw: 'gen_random_uuid()' },
    advertiser: { type: 'string' },
    filePath: { type: 'string' },
    durationSeconds: { type: 'float' },
    createdAt: {
      type: 'Date',
      onCreate: () => new Date(),
      defaultRaw: 'now()',
    },
  },
});

export const JingleSchema = new EntitySchema<Jingle>({
  class: Jingle,
  tableName: 'jingle',
  properties: {
    id: { type: 'uuid', primary: true, defaultRaw: 'gen_random_uuid()' },
    name: { type: 'string' },
    filePath: { type: 'string' },
    durationSeconds: { type: 'float' },
    createdAt: {
      type: 'Date',
      onCreate: () => new Date(),
      defaultRaw: 'now()',
    },
  },
});
