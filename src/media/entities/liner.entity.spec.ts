import { MikroORM } from '@mikro-orm/postgresql';
import config from '../../infrastructure/database/mikro-orm.config';
import { Liner } from './liner.entity';

describe('Liner', () => {
  it('trims the spoken text and rejects an empty one', () => {
    const liner = new Liner(
      '  We will be right back.  ',
      'liners/back-01.mp3',
      4.2,
    );
    expect(liner.text).toBe('We will be right back.');
    expect(liner.filePath).toBe('liners/back-01.mp3');
    expect(liner.durationSeconds).toBe(4.2);

    expect(() => new Liner('   ', 'liners/back-01.mp3', 4.2)).toThrow(
      'text cannot be empty',
    );
  });

  it('rejects a blank file path and a non-positive duration', () => {
    expect(() => new Liner('We will be right back.', '  ', 4.2)).toThrow(
      'filePath cannot be empty',
    );

    expect(
      () => new Liner('We will be right back.', 'liners/back-01.mp3', 0),
    ).toThrow('durationSeconds must be > 0');

    expect(
      () => new Liner('We will be right back.', 'liners/back-01.mp3', -1),
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
describe('reading a liner back out of the database', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({ ...config, connect: false });
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it('round trips a liner row, its id included', () => {
    const liner = orm.em.fork().map(Liner, {
      id: '77777777-7777-7777-7777-777777777777',
      text: 'We will be right back.',
      file_path: 'liners/back-01.mp3',
      duration_seconds: 5,
      created_at: when,
    });

    expect(liner.id).toBe('77777777-7777-7777-7777-777777777777');
    expect(liner.text).toBe('We will be right back.');
    expect(liner.filePath).toBe('liners/back-01.mp3');
    expect(liner.durationSeconds).toBe(5);
  });
});
