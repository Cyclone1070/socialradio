import { EntitySchema } from '@mikro-orm/core';
import { MusicTrack } from '../../../media/entities/music-track.entity';
import { Jingle } from '../../../media/entities/jingle.entity';
import { Liner } from '../../../media/entities/liner.entity';

export const MusicTrackSchema = new EntitySchema<MusicTrack>({
  class: MusicTrack,
  tableName: 'music_track',
  properties: {
    id: {
      type: 'uuid',
      primary: true,
      defaultRaw: 'gen_random_uuid()',
      accessor: true,
    },
    title: { type: 'string', accessor: true },
    artist: { type: 'string', accessor: true },
    filePath: { type: 'string', unique: true, accessor: true },
    durationSeconds: { type: 'float', accessor: true },
    createdAt: {
      type: 'Date',
      defaultRaw: 'now()',
      accessor: true,
    },
  },
  checks: [
    {
      name: 'music_track_duration_positive',
      expression: 'duration_seconds > 0',
    },
  ],
});

export const JingleSchema = new EntitySchema<Jingle>({
  class: Jingle,
  tableName: 'jingle',
  properties: {
    id: {
      type: 'uuid',
      primary: true,
      defaultRaw: 'gen_random_uuid()',
      accessor: true,
    },
    name: { type: 'string', accessor: true },
    filePath: { type: 'string', unique: true, accessor: true },
    durationSeconds: { type: 'float', accessor: true },
    createdAt: {
      type: 'Date',
      defaultRaw: 'now()',
      accessor: true,
    },
  },
  checks: [
    {
      name: 'jingle_duration_positive',
      expression: 'duration_seconds > 0',
    },
  ],
});

export const LinerSchema = new EntitySchema<Liner>({
  class: Liner,
  tableName: 'liner',
  properties: {
    id: {
      type: 'uuid',
      primary: true,
      defaultRaw: 'gen_random_uuid()',
      accessor: true,
    },
    text: { type: 'string', accessor: true },
    filePath: { type: 'string', unique: true, accessor: true },
    durationSeconds: { type: 'float', accessor: true },
    createdAt: {
      type: 'Date',
      defaultRaw: 'now()',
      accessor: true,
    },
  },
  checks: [
    {
      name: 'liner_duration_positive',
      expression: 'duration_seconds > 0',
    },
  ],
});
