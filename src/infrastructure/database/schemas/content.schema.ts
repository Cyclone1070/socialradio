import { EntitySchema } from '@mikro-orm/core';
import { Subreddit } from '../../../content/entities/subreddit.entity';
import { Post } from '../../../content/entities/post.entity';
import { Comment } from '../../../content/entities/comment.entity';

export const SubredditSchema = new EntitySchema<Subreddit>({
  class: Subreddit,
  tableName: 'subreddit',
  properties: {
    id: { type: 'uuid', primary: true, defaultRaw: 'gen_random_uuid()' },
    name: { type: 'string', unique: true },
    lastScrapedAt: { type: 'Date', nullable: true },
    scrapeStartedAt: { type: 'Date', nullable: true },
    scrapeCooldownUntil: { type: 'Date', nullable: true },
    createdAt: {
      type: 'Date',
      onCreate: () => new Date(),
      defaultRaw: 'now()',
    },
  },
});

export const PostSchema = new EntitySchema<Post>({
  class: Post,
  tableName: 'post',
  properties: {
    id: { type: 'uuid', primary: true, defaultRaw: 'gen_random_uuid()' },
    subreddit: {
      kind: 'm:1',
      entity: () => Subreddit,
      joinColumn: 'subredditId',
      deleteRule: 'cascade',
    },
    subredditId: { type: 'string', persist: false },
    redditId: { type: 'string', unique: true },
    title: { type: 'string' },
    body: { type: 'text' },
    score: { type: 'integer' },
    redditCreatedAt: { type: 'Date' },
    scrapedAt: {
      type: 'Date',
      onCreate: () => new Date(),
      defaultRaw: 'now()',
    },
    comments: {
      kind: '1:m',
      entity: () => Comment,
      mappedBy: 'post',
    },
  },
  indexes: [{ properties: ['subreddit'] }, { properties: ['scrapedAt'] }],
});

export const CommentSchema = new EntitySchema<Comment>({
  class: Comment,
  tableName: 'comment',
  properties: {
    id: { type: 'uuid', primary: true, defaultRaw: 'gen_random_uuid()' },
    post: {
      kind: 'm:1',
      entity: () => Post,
      joinColumn: 'postId',
      deleteRule: 'cascade',
    },
    postId: { type: 'string', persist: false },
    redditId: { type: 'string', unique: true },
    body: { type: 'text' },
    score: { type: 'integer' },
    parentRedditId: { type: 'string', nullable: true },
    isOp: { type: 'boolean', default: false },
    redditCreatedAt: { type: 'Date' },
  },
  indexes: [{ properties: ['post'] }],
});
