import { EntitySchema, DeferMode } from '@mikro-orm/core';
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
import { User } from '../../../user/entities/user.entity';

export const ChannelSchema = new EntitySchema<Channel>({
  class: Channel,
  tableName: 'channel',
  properties: {
    id: {
      type: 'uuid',
      primary: true,
      defaultRaw: 'gen_random_uuid()',
      accessor: true,
    },
    name: { type: 'string', accessor: true },
    visibility: { type: 'string', default: 'public', accessor: true },
    ownerId: {
      kind: 'm:1',
      entity: () => User,
      joinColumn: 'owner_id',
      mapToPk: true,
      nullable: true,
      deleteRule: 'set null',
    },
    currentSegmentId: {
      kind: 'm:1',
      entity: () => Segment,
      joinColumn: 'current_segment_id',
      mapToPk: true,
      nullable: true,
      deleteRule: 'set null',
      deferMode: DeferMode.INITIALLY_DEFERRED,
    },
    currentPlayOrder: { type: 'integer', nullable: true, accessor: true },
    playheadStartedAt: { type: 'Date', nullable: true, accessor: true },
    lastActiveAt: { type: 'Date', nullable: true, accessor: true },
    createdAt: {
      type: 'Date',
      defaultRaw: 'now()',
      accessor: true,
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
  indexes: [{ properties: ['currentSegmentId'] }, { properties: ['ownerId'] }],
  checks: [
    { name: 'channel_name_not_empty', expression: 'length(trim(name)) > 0' },
    {
      name: 'channel_visibility_check',
      expression: "visibility in ('public', 'private')",
    },
    {
      name: 'channel_play_order_positive',
      expression: 'current_play_order is null or current_play_order >= 1',
    },
  ],
});

export const SegmentSchema = new EntitySchema<Segment>({
  class: Segment,
  tableName: 'segment',
  discriminatorColumn: 'type',
  abstract: true,
  properties: {
    id: {
      type: 'uuid',
      primary: true,
      defaultRaw: 'gen_random_uuid()',
      accessor: true,
    },
    channel: {
      kind: 'm:1',
      entity: () => Channel,
      joinColumn: 'channelId',
      deleteRule: 'cascade',
    },
    channelId: { type: 'string', persist: false },
    playOrder: { type: 'integer', accessor: true },
    audioUrl: { type: 'string' },
    durationSeconds: { type: 'float', accessor: true },
    type: { type: 'string' },
    createdAt: {
      type: 'Date',
      defaultRaw: 'now()',
      accessor: true,
    },
  },
  uniques: [{ properties: ['channel', 'playOrder'] }],
  indexes: [{ properties: ['channel'] }],
  checks: [
    { name: 'segment_play_order_positive', expression: 'play_order >= 1' },
    {
      name: 'segment_duration_bounds',
      expression: 'duration_seconds > 0 and duration_seconds <= 7200',
    },
    {
      name: 'segment_type_check',
      expression: "type in ('music', 'talk', 'ad', 'jingle')",
    },
    {
      name: 'segment_status_check',
      expression:
        "status is null or status in ('generating', 'ready', 'failed')",
    },
    {
      name: 'segment_music_subtype_check',
      expression:
        "type != 'music' or (title is not null and artist is not null)",
    },
    {
      name: 'segment_talk_subtype_check',
      expression: "type != 'talk' or (cluster_id is not null)",
    },
  ],
});

export const MusicSegmentSchema = new EntitySchema<MusicSegment, Segment>({
  class: MusicSegment,
  extends: SegmentSchema,
  discriminatorValue: 'music',
  properties: {
    title: { type: 'string', accessor: true },
    artist: { type: 'string', accessor: true },
  },
});

export const TalkSegmentSchema = new EntitySchema<TalkSegment, Segment>({
  class: TalkSegment,
  extends: SegmentSchema,
  discriminatorValue: 'talk',
  properties: {
    clusterId: { type: 'string', accessor: true },
    status: { type: 'string', default: 'generating', accessor: true },
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
