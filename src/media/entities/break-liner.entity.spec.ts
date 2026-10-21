import { MikroORM } from '@mikro-orm/postgresql';
import config from '../../infrastructure/database/mikro-orm.config';
import { BreakLiner } from './break-liner.entity';

describe('BreakLiner', () => {
  it('trims the spoken text and rejects an empty one', () => {
    const breakLiner = new BreakLiner(
      '  We will be right back.  ',
      'break_liners/back-01.mp3',
      4.2,
    );
    expect(breakLiner.text).toBe('We will be right back.');
    expect(breakLiner.filePath).toBe('break_liners/back-01.mp3');
    expect(breakLiner.durationSeconds).toBe(4.2);

    expect(
      () => new BreakLiner('   ', 'break_liners/back-01.mp3', 4.2),
    ).toThrow('text cannot be empty');
  });

  it('rejects a blank file path and a non-positive duration', () => {
    expect(() => new BreakLiner('We will be right back.', '  ', 4.2)).toThrow(
      'filePath cannot be empty',
    );

    expect(
      () =>
        new BreakLiner('We will be right back.', 'break_liners/back-01.mp3', 0),
    ).toThrow('durationSeconds must be > 0');

    expect(
      () =>
        new BreakLiner(
          'We will be right back.',
          'break_liners/back-01.mp3',
          -1,
        ),
    ).toThrow('durationSeconds must be > 0');
  });
});

const when = new Date('2026-01-01T00:00:00.000Z');

/**
 * The mapper hydrates every column, the id included, by writing to the entity's
 * accessors. An entity that only reads its id cannot be loaded from the database at
 * all, and the failure only shows up against a real table - which is how a station
 * ended up airing music with no announcement in front of it.
 */
describe('reading a break liner back out of the database', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({ ...config, connect: false });
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it('round trips a break liner row, its id included', () => {
    const breakLiner = orm.em.fork().map(BreakLiner, {
      id: '77777777-7777-7777-7777-777777777777',
      text: 'We will be right back.',
      file_path: 'break_liners/back-01.mp3',
      duration_seconds: 5,
      created_at: when,
    });

    expect(breakLiner.id).toBe('77777777-7777-7777-7777-777777777777');
    expect(breakLiner.text).toBe('We will be right back.');
    expect(breakLiner.filePath).toBe('break_liners/back-01.mp3');
    expect(breakLiner.durationSeconds).toBe(5);
  });
});
