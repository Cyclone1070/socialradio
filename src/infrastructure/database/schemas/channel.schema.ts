import { EntitySchema } from '@mikro-orm/core';
import { Channel } from '../../../channel/entities/channel.entity';
import {
  Segment,
  MusicSegment,
  TalkSegment,
  AdSegment,
  JingleSegment,
} from '../../../channel/entities/segment.entity';
import { Subreddit } from '../../../content/entities/subreddit.entity';
import { Post } from '../../../content/entities/post.entity';

export const ChannelSchema = new EntitySchema<Channel>({
  class: Channel,
  tableName: 'channel',
  properties: {
    id: { type: 'uuid', primary: true, defaultRaw: 'gen_random_uuid()' },
    name: { type: 'string' },
    visibility: { type: 'string', default: 'public' },
    ownerId: { type: 'string', nullable: true },
    currentSegmentId: { type: 'string', nullable: true },
    createdAt: {
      type: 'Date',
      onCreate: () => new Date(),
      defaultRaw: 'now()',
    },
    subreddits: {
      kind: 'm:n',
      entity: () => Subreddit,
      pivotTable: 'channel_subreddit',
      joinColumn: 'channelId',
      inverseJoinColumn: 'subredditId',
    },
    completedPosts: {
      kind: 'm:n',
      entity: () => Post,
      pivotTable: 'channel_post_progress',
      joinColumn: 'channelId',
      inverseJoinColumn: 'postId',
    },
  },
});

export const SegmentSchema = new EntitySchema<Segment>({
  class: Segment,
  tableName: 'segment',
  discriminatorColumn: 'type',
  abstract: true,
  properties: {
    id: { type: 'uuid', primary: true, defaultRaw: 'gen_random_uuid()' },
    channel: {
      kind: 'm:1',
      entity: () => Channel,
      joinColumn: 'channelId',
      deleteRule: 'cascade',
    },
    channelId: { type: 'string', persist: false },
    playOrder: { type: 'integer' },
    audioUrl: { type: 'string', nullable: true },
    durationSeconds: { type: 'float', nullable: true },
    type: { type: 'string' },
    createdAt: {
      type: 'Date',
      onCreate: () => new Date(),
      defaultRaw: 'now()',
    },
  },
  indexes: [
    { properties: ['channel'] },
    { properties: ['channel', 'playOrder'] },
  ],
});

export const MusicSegmentSchema = new EntitySchema<MusicSegment, Segment>({
  class: MusicSegment,
  extends: SegmentSchema,
  discriminatorValue: 'music',
  properties: {
    title: { type: 'string' },
    artist: { type: 'string' },
  },
});

export const TalkSegmentSchema = new EntitySchema<TalkSegment, Segment>({
  class: TalkSegment,
  extends: SegmentSchema,
  discriminatorValue: 'talk',
  properties: {
    clusterId: { type: 'string' },
    status: { type: 'string', default: 'generating' },
    script: { type: 'json', nullable: true },
  },
});

export const AdSegmentSchema = new EntitySchema<AdSegment, Segment>({
  class: AdSegment,
  extends: SegmentSchema,
  discriminatorValue: 'ad',
  properties: {},
});

export const JingleSegmentSchema = new EntitySchema<JingleSegment, Segment>({
  class: JingleSegment,
  extends: SegmentSchema,
  discriminatorValue: 'jingle',
  properties: {},
});
