/**
 * Puts the break-out lines into the liner pool.
 *
 * Usage:
 *   npx ts-node deployment/tools/seed-liners.ts --dry-run
 *   npx ts-node deployment/tools/seed-liners.ts --count 40
 *
 * It never overwrites and never re-adds: the plan is computed from the texts
 * already stored, so running it twice stores nothing the second time.
 */
import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../src/infrastructure/database/mikro-orm.config';
import { Liner } from '../../src/media/entities/liner.entity';
import { BREAK_LINERS, planLinerSeed } from '../../src/media/liner-pool';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const requested = argument('--count');
  const count = requested === undefined ? BREAK_LINERS.length : Number(requested);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`--count must be a whole number, got "${requested}"`);
  }

  const orm = await MikroORM.init(mikroOrmConfig);
  const em = orm.em.fork();

  const stored = await em.find(Liner, {});
  const existing = stored.map((liner) => liner.text);
  const missing = planLinerSeed(existing, count);

  process.stdout.write(
    `liner pool: ${BREAK_LINERS.length} written, ${existing.length} stored, ${missing.length} to add\n`,
  );
  for (const text of missing) process.stdout.write(`  + ${text}\n`);

  if (dryRun) {
    process.stdout.write('dry run: nothing written\n');
  } else {
    for (const text of missing) {
      // The audio file itself is produced by the speech pipeline, not here.
      em.create(Liner, {
        text,
        filePath: `liners/${slug(text)}.mp3`,
        durationSeconds: 5,
      });
    }
    await em.flush();
    process.stdout.write(`stored ${missing.length} liner(s)\n`);
  }

  await orm.close(true);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
