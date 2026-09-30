import { MikroORM } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import * as fs from 'fs';
import * as path from 'path';
import config from './mikro-orm.config';

const migrationsDir = path.join(__dirname, 'migrations');

/**
 * `getSchemaDiff` is private on the Migrator; it is the only way to ask
 * "what would a new migration contain?" without a live database, because the
 * committed snapshot is what the diff is computed against.
 */
type SchemaDiffer = {
  getSchemaDiff(): Promise<SchemaDiff>;
};

interface SchemaDiff {
  up: string[];
  down: string[];
}

function migrationFiles(): string[] {
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => /^Migration.*\.ts$/.test(name))
    .sort();
}

function migrationSql(): string {
  return migrationFiles()
    .map((name) => fs.readFileSync(path.join(migrationsDir, name), 'utf-8'))
    .join('\n');
}

describe('Migration schema snapshot', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({ ...config, connect: false });
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it('matches the current entities, so a new migration would be empty', async () => {
    const differ = new Migrator(orm.em) as unknown as SchemaDiffer;
    const diff = await differ.getSchemaDiff();

    expect({ up: diff.up, down: diff.down }).toEqual({ up: [], down: [] });
  });

  describe('committed migrations', () => {
    it('are a single migration that only contains generated statements', () => {
      expect(migrationFiles()).toHaveLength(1);

      const statements = migrationSql().match(
        /rename column|drop column|alter column|update "|insert into/gi,
      );

      expect(statements).toBeNull();
    });

    it('create every table the entities declare, including the pivot tables', () => {
      const sql = migrationSql();
      const missing = Object.values(orm.getMetadata().getAll())
        .map((meta) => meta.tableName)
        .filter((table) => !sql.includes(`create table "${table}"`));

      expect(missing).toEqual([]);
      expect(sql).toContain('create table "channel_subreddit"');
      expect(sql).toContain('create table "channel_post_progress"');
      expect(sql).toContain('"channel_id"');
      expect(sql).toContain('"subreddit_id"');
      expect(sql).toContain('"post_id"');
    });
  });
});
