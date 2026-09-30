import { EntitySchema } from '@mikro-orm/core';
import { Subreddit } from '../../../content/entities/subreddit.entity';
import { Post } from '../../../content/entities/post.entity';
import { Comment } from '../../../content/entities/comment.entity';

export const SubredditSchema = new EntitySchema<Subreddit>({
  class: Subreddit,
  tableName: 'subreddit',
  properties: {
    id: {
      type: 'uuid',
      primary: true,
      defaultRaw: 'gen_random_uuid()',
      accessor: true,
    },
    name: { type: 'string', unique: true, accessor: true },
    lastScrapedAt: { type: 'Date', nullable: true, accessor: true },
    scrapeStartedAt: { type: 'Date', nullable: true, accessor: true },
    scrapeCooldownUntil: { type: 'Date', nullable: true, accessor: true },
    createdAt: {
      type: 'Date',
      defaultRaw: 'now()',
      accessor: true,
    },
  },
  checks: [
    {
      name: 'subreddit_name_not_empty',
      expression: 'length(trim(name)) > 0',
    },
  ],
});

export const PostSchema = new EntitySchema<Post>({
  class: Post,
  tableName: 'post',
  properties: {
    id: {
      type: 'uuid',
      primary: true,
      defaultRaw: 'gen_random_uuid()',
      accessor: true,
    },
    subredditId: {
      kind: 'm:1',
      entity: () => Subreddit,
      joinColumn: 'subreddit_id',
      mapToPk: true,
      deleteRule: 'cascade',
    },
    redditId: { type: 'string', unique: true, accessor: true },
    title: { type: 'text', accessor: true },
    body: { type: 'text', accessor: true },
    score: { type: 'integer', accessor: true },
    redditCreatedAt: { type: 'Date', accessor: true },
    scrapedAt: {
      type: 'Date',
      defaultRaw: 'now()',
      accessor: true,
    },
    comments: {
      kind: '1:m',
      entity: () => Comment,
      mappedBy: 'postId',
    },
  },
  indexes: [{ properties: ['subredditId'] }, { properties: ['scrapedAt'] }],
});

export const CommentSchema = new EntitySchema<Comment>({
  class: Comment,
  tableName: 'comment',
  properties: {
    id: {
      type: 'uuid',
      primary: true,
      defaultRaw: 'gen_random_uuid()',
      accessor: true,
    },
    postId: {
      kind: 'm:1',
      entity: () => Post,
      joinColumn: 'post_id',
      mapToPk: true,
      deleteRule: 'cascade',
    },
    redditId: { type: 'string', unique: true, accessor: true },
    body: { type: 'text', accessor: true },
    score: { type: 'integer', accessor: true },
    parentRedditId: { type: 'string', nullable: true, accessor: true },
    isOp: { type: 'boolean', default: false, accessor: true },
    redditCreatedAt: { type: 'Date', accessor: true },
  },
  indexes: [{ properties: ['postId'] }],
});
