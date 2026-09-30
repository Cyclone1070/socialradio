import { MikroORM } from '@mikro-orm/postgresql';
import config from './mikro-orm.config';
import * as schemas from './schemas';
import { Channel } from '../../channel/entities/channel.entity';
import { MusicSegment } from '../../channel/entities/segment.entity';
import { Comment } from '../../content/entities/comment.entity';
import { Post } from '../../content/entities/post.entity';
import { MusicTrack } from '../../media/entities/music-track.entity';

const when = new Date('2026-01-01T00:00:00.000Z');
const CHANNEL_ID = '55555555-5555-5555-5555-555555555555';
const SUBREDDIT_ID = '22222222-2222-2222-2222-222222222222';
const POST_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_SUBREDDIT_ID = '99999999-9999-9999-9999-999999999999';
const OTHER_POST_ID = '88888888-8888-8888-8888-888888888888';
const OTHER_CHANNEL_ID = '77777777-7777-7777-7777-777777777777';

describe('Database mapping round trips', () => {
  let orm: MikroORM;

  const fork = () => orm.em.fork();

  beforeAll(async () => {
    orm = await MikroORM.init({ ...config, connect: false });
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it('reads parent keys back as scalars for rows loaded from the database', () => {
    const post = fork().map(Post, {
      id: POST_ID,
      subreddit_id: SUBREDDIT_ID,
      reddit_id: 'r1',
      title: 'title',
      body: 'body',
      score: 1,
      reddit_created_at: when,
      scraped_at: when,
    });
    const comment = fork().map(Comment, {
      id: '33333333-3333-3333-3333-333333333333',
      post_id: POST_ID,
      reddit_id: 'rc1',
      body: 'body',
      score: 1,
      parent_reddit_id: null,
      is_op: false,
      reddit_created_at: when,
    });
    const segment = fork().map(MusicSegment, {
      id: '44444444-4444-4444-4444-444444444444',
      type: 'music',
      channel_id: CHANNEL_ID,
      play_order: 1,
      audio_url: 'audio.mp3',
      duration_seconds: 30,
      created_at: when,
      title: 'title',
      artist: 'artist',
    });
    const channel = fork().map(Channel, {
      id: CHANNEL_ID,
      name: 'channel',
      visibility: 'public',
      owner_id: null,
      current_segment_id: '44444444-4444-4444-4444-444444444444',
      current_play_order: 1,
      playhead_started_at: when,
      last_active_at: when,
      created_at: when,
    });

    expect(post.subredditId).toBe(SUBREDDIT_ID);
    expect(comment.postId).toBe(POST_ID);
    expect(segment.channelId).toBe(CHANNEL_ID);
    expect(channel.currentSegmentId).toBe(
      '44444444-4444-4444-4444-444444444444',
    );
  });

  it('saves parent keys for newly created entities', () => {
    const post = new Post(
      OTHER_SUBREDDIT_ID,
      'r9',
      'title',
      'body',
      4,
      when,
      when,
    );
    const comment = new Comment(
      OTHER_POST_ID,
      'rc9',
      'body',
      2,
      null,
      false,
      when,
    );
    const segment = new MusicSegment('title', 'artist');
    segment.channelId = OTHER_CHANNEL_ID;
    segment.playOrder = 1;
    segment.audioUrl = 'audio.mp3';
    segment.durationSeconds = 30;

    const payload = (entity: object) =>
      JSON.stringify(fork().getComparator().prepareEntity(entity));

    expect(payload(post)).toContain(OTHER_SUBREDDIT_ID);
    expect(payload(comment)).toContain(OTHER_POST_ID);
    expect(payload(segment)).toContain(OTHER_CHANNEL_ID);
  });

  it('keeps no shadow copies of mapped columns', () => {
    const shadows: string[] = [];
    for (const schema of Object.values(schemas)) {
      const meta = schema.meta as {
        className: string;
        properties: Record<string, { persist?: boolean } | undefined>;
      };
      for (const [name, prop] of Object.entries(meta.properties)) {
        if (prop?.persist === false) {
          shadows.push(`${meta.className}.${name}`);
        }
      }
    }

    expect(shadows).toEqual([]);
  });

  it('round trips scalar-only entities', () => {
    const track = fork().map(MusicTrack, {
      id: '66666666-6666-6666-6666-666666666666',
      title: 'Song',
      artist: 'Band',
      file_path: 'song.mp3',
      duration_seconds: 12,
      created_at: when,
    });

    expect(track.title).toBe('Song');
    expect(track.artist).toBe('Band');
    expect(track.durationSeconds).toBe(12);
  });

  it('maps every column with the snake_case convention', () => {
    const entities = Object.values(orm.getMetadata().getAll()).map((meta) => ({
      className: meta.className,
      props: meta.props.map((prop) => ({
        name: prop.name,
        fieldNames: prop.fieldNames,
        joinColumns: prop.joinColumns,
        inverseJoinColumns: prop.inverseJoinColumns,
      })),
    }));

    // A metadata set that came back empty would make this pass for the wrong reason.
    expect(entities.length).toBeGreaterThanOrEqual(9);
    expect(columnCasingOffenders(entities)).toEqual([]);
  });

  it('reports a camelCase column, so the convention is really enforced', () => {
    const offenders = columnCasingOffenders([
      {
        className: 'Ghost',
        props: [{ name: 'redditId', fieldNames: ['redditId'] }],
      },
      {
        className: 'Fine',
        props: [{ name: 'redditId', fieldNames: ['reddit_id'] }],
      },
    ]);

    expect(offenders).toEqual(['Ghost.redditId -> redditId']);
  });
});

/**
 * Every persisted column is snake_case, whatever kind of property produced it:
 * a scalar column, a foreign key, or one side of a pivot table. Scalar columns
 * are the ones that drift, because a relationship usually names its join column
 * explicitly while a scalar silently takes the naming strategy's default.
 */
type EntityShape = {
  className: string;
  props: {
    name: string;
    fieldNames?: string[];
    joinColumns?: string[];
    inverseJoinColumns?: string[];
  }[];
};

function columnCasingOffenders(entities: EntityShape[]): string[] {
  const offenders: string[] = [];

  for (const entity of entities) {
    for (const prop of entity.props) {
      if (prop.name.includes('__inverse')) {
        continue;
      }

      const columns = [
        ...(prop.fieldNames ?? []),
        ...(prop.joinColumns ?? []),
        ...(prop.inverseJoinColumns ?? []),
      ];

      for (const column of columns) {
        if (!/^[a-z][a-z0-9_]*$/.test(column)) {
          offenders.push(`${entity.className}.${prop.name} -> ${column}`);
        }
      }
    }
  }

  return offenders;
}
