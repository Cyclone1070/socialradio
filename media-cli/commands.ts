/**
 * The four operations, one file each would be tidier but they share the same
 * three inputs - the manifest, the local mirror, the bucket - and reading them
 * side by side is how you see that `publish` and `promote` are the same move
 * against different sources.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { ConfigService } from '@nestjs/config';
import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../src/infrastructure/database/mikro-orm.config';
import { StorageService } from '../src/infrastructure/storage/storage.service';
import { AudioService } from '../src/voice/audio.service';
import { contentKey, breakLinerKey } from './keys';
import { LibraryEntry, withEntry } from './manifest';
import { LibraryPlan, LibrarySeeder } from './seeder';
import { MikroLibraryStore } from './store';
import {
  argument,
  manifestPath,
  readLines,
  readManifest,
  writeManifest,
} from './lib';

// The decisions each command makes, separated from the I/O that carries them
// out. Nothing below this line touches a file, a bucket or a database, so the
// parts that can be wrong are stated once and tested directly.
/** Which pool lines have no clip yet, up to the batch size asked for. */
export function speakPlan(
  pool: readonly string[],
  entries: LibraryEntry[],
  limit: number,
): { lines: string[]; recorded: number } {
  const recorded = new Set(
    entries.flatMap((entry) =>
      entry.kind === 'break_liner' ? [entry.text.trim().toLowerCase()] : [],
    ),
  );
  return {
    recorded: recorded.size,
    lines: pool
      .filter((line) => !recorded.has(line.trim().toLowerCase()))
      .slice(0, limit),
  };
}

export function publishPlan(
  entries: LibraryEntry[],
  present: ReadonlySet<string>,
): { toUpload: LibraryEntry[]; alreadyThere: number } {
  const toUpload = entries.filter((entry) => !present.has(entry.key));
  return { toUpload, alreadyThere: entries.length - toUpload.length };
}

export function promotePlan(
  entries: LibraryEntry[],
  inTarget: ReadonlySet<string>,
  inSource: ReadonlySet<string>,
): { toCopy: LibraryEntry[]; alreadyThere: number; absent: string[] } {
  const toCopy: LibraryEntry[] = [];
  const absent: string[] = [];
  let alreadyThere = 0;
  for (const entry of entries) {
    if (inTarget.has(entry.key)) alreadyThere += 1;
    else if (inSource.has(entry.key)) toCopy.push(entry);
    else absent.push(entry.key);
  }
  return { toCopy, alreadyThere, absent };
}

/** The inventory entry for a file, named by a fingerprint of its content. */
export function entryFor(
  kind: 'music' | 'jingle',
  name: string,
  content: Buffer,
  durationSeconds: number,
  artist?: string,
): LibraryEntry {
  const key = contentKey(kind, name, content);
  return kind === 'music'
    ? { kind, key, durationSeconds, title: name, artist: artist ?? 'Unknown' }
    : { kind, key, durationSeconds, name };
}

export function seedReport(plan: LibraryPlan): string[] {
  const lines = [
    `${plan.add.length} to add, ${plan.update.length} to correct, ${plan.unchanged.length} already there`,
  ];
  for (const entry of plan.add) {
    lines.push(`  + ${entry.key} (${entry.kind}, ${entry.durationSeconds}s)`);
  }
  for (const entry of plan.update) {
    lines.push(`  ~ ${entry.key} (${entry.kind}, ${entry.durationSeconds}s)`);
  }
  for (const entry of plan.missing) {
    lines.push(`  ! ${entry.key} has no audio in the bucket, leaving it out`);
  }
  return lines;
}

/** Which of these keys the bucket already holds. */
async function present(
  entries: LibraryEntry[],
  storage: StorageService,
): Promise<Set<string>> {
  const held = new Set<string>();
  for (const entry of entries) {
    if (await storage.exists(entry.key)) held.add(entry.key);
  }
  return held;
}

const storageFor = (bucket?: string): StorageService =>
  new StorageService(
    new ConfigService(bucket ? { STORAGE_BUCKET: bucket } : {}),
  );

function measuredSeconds(file: string): number {
  const output = execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]).toString();
  const seconds = Number(output.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe could not measure ${file}: "${output.trim()}"`);
  }
  return Math.round(seconds * 100) / 100;
}

/** A song or a jingle enters the inventory: measured once, named by its content. */
export function addMedia(argv: string[]): void {
  const file = argv[0];
  if (!file || file.startsWith('--') || !fs.existsSync(file)) {
    throw new Error(
      'usage: add <file> --kind music --title <title> [--artist <artist>] | --kind jingle --name <name>',
    );
  }
  const kind = argument(argv, '--kind');
  if (kind !== 'music' && kind !== 'jingle') {
    throw new Error('--kind must be music or jingle');
  }

  const name =
    kind === 'music'
      ? (argument(argv, '--title') ?? '')
      : (argument(argv, '--name') ?? '');
  if (!name.trim()) {
    throw new Error(`--${kind === 'music' ? 'title' : 'name'} is required`);
  }

  const entry = entryFor(
    kind,
    name,
    fs.readFileSync(file),
    measuredSeconds(file),
    argument(argv, '--artist'),
  );

  const mirror = path.join('library', 'files', entry.key);
  fs.mkdirSync(path.dirname(mirror), { recursive: true });
  fs.copyFileSync(file, mirror);

  const entries = withEntry(readManifest(), entry);
  writeManifest(entries);

  process.stdout.write(`${entry.key} (${entry.durationSeconds}s)\n`);
  process.stdout.write(`${entries.length} entry(s) in ${manifestPath()}\n`);
  process.stdout.write(
    'next: npm run media -- publish, then commit the manifest\n',
  );
}

/** Speaks the lines that have no clip yet. The words are the identity. */
export async function speakLibrary(argv: string[]): Promise<void> {
  const dryRun = argv.includes('--dry-run');
  const requested = argument(argv, '--count');
  const pump = readLines();
  const limit = requested === undefined ? pump.length : Number(requested);
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error(`--count must be a whole number, got "${requested}"`);
  }

  const entries = readManifest();
  const plan = speakPlan(pump, entries, limit);
  const unspoken = plan.lines;

  process.stdout.write(
    `${pump.length} line(s) in the pool, ${plan.recorded} already recorded, ${unspoken.length} to speak\n`,
  );
  for (const line of unspoken) process.stdout.write(`  + ${line}\n`);

  if (dryRun) {
    process.stdout.write('dry run: nothing spoken, nothing written\n');
    return;
  }

  const config = new ConfigService();
  const audio = new AudioService(config, storageFor());
  let recorded = entries;
  for (const line of unspoken) {
    const key = breakLinerKey(line);
    const track = await audio.synthesizeScript(
      { postId: key, turns: [{ speaker: 'Dave', text: line }] },
      key,
    );
    recorded = withEntry(recorded, {
      kind: 'break_liner',
      key,
      durationSeconds: track.durationSeconds,
      text: line,
    });
    process.stdout.write(`  ${key} (${track.durationSeconds}s)\n`);
  }
  writeManifest(recorded);
  process.stdout.write('manifest updated\n');
}

/**
 * Uploads from the local mirror. A key carries a fingerprint of its content, so
 * a key the bucket already holds already holds exactly this audio.
 */
export async function publishLibrary(argv: string[]): Promise<void> {
  const dryRun = argv.includes('--dry-run');
  const entries = readManifest();
  if (entries.length === 0) {
    process.stdout.write('the manifest is empty, nothing to publish\n');
    return;
  }

  const unmirrored = entries.filter(
    (entry) => !fs.existsSync(path.join('library', 'files', entry.key)),
  );
  if (unmirrored.length > 0) {
    throw new Error(
      `no local audio for ${unmirrored.length} entry(s): ${unmirrored
        .map((entry) => entry.key)
        .join(', ')}`,
    );
  }

  const storage = storageFor();
  const plan = publishPlan(entries, await present(entries, storage));
  for (const entry of plan.toUpload) {
    if (dryRun) {
      process.stdout.write(`  + would upload ${entry.key}\n`);
      continue;
    }
    await storage.write({
      key: entry.key,
      content: fs.readFileSync(path.join('library', 'files', entry.key)),
      contentType: 'audio/mpeg',
    });
    process.stdout.write(`  + ${entry.key}\n`);
  }
  process.stdout.write(
    `${plan.toUpload.length} ${dryRun ? 'to upload' : 'uploaded'}, ${plan.alreadyThere} already in the bucket\n`,
  );
}

/**
 * Copies the library between buckets, restricted to what the manifest lists: a
 * bucket is not synced wholesale, because anything in it that the inventory does
 * not mention is not part of the station.
 */
export async function promoteLibrary(argv: string[]): Promise<void> {
  const dryRun = argv.includes('--dry-run');
  const from = argument(argv, '--from');
  const to = argument(argv, '--to');
  if (!from || !to) {
    throw new Error(
      'usage: promote --from <source bucket> --to <target bucket>',
    );
  }

  const entries = readManifest();
  const source = storageFor(from);
  const target = storageFor(to);
  const plan = promotePlan(
    entries,
    await present(entries, target),
    await present(entries, source),
  );

  for (const entry of plan.toCopy) {
    if (dryRun) {
      process.stdout.write(`  + would copy ${entry.key}\n`);
      continue;
    }
    await target.write({
      key: entry.key,
      content: await source.read(entry.key),
      contentType: 'audio/mpeg',
    });
    process.stdout.write(`  + ${entry.key}\n`);
  }

  process.stdout.write(
    `${plan.toCopy.length} ${dryRun ? 'to copy' : 'copied'}, ${plan.alreadyThere} already in ${to}\n`,
  );
  if (plan.absent.length > 0) {
    // The source bucket is behind the manifest: promoting what is there would
    // ship a station quietly emptier than its inventory says.
    throw new Error(
      `${plan.absent.length} entr(y/ies) has no audio in ${from}: ${plan.absent.join(', ')}`,
    );
  }
}

/** Makes the database a projection of the manifest. */
export async function seedLibrary(argv: string[]): Promise<LibraryPlan> {
  const dryRun = argv.includes('--dry-run');
  const entries = readManifest();
  const orm = await MikroORM.init(mikroOrmConfig);
  try {
    const seeder = new LibrarySeeder(
      new MikroLibraryStore(orm.em.fork()),
      storageFor(),
    );
    return await seeder.run(entries, { dryRun });
  } finally {
    await orm.close(true);
  }
}

export function printSeedReport(plan: LibraryPlan): void {
  for (const line of seedReport(plan)) process.stdout.write(`${line}\n`);
  // A row is never written for audio the bucket does not hold: say so loudly
  // enough that a deploy stops rather than shipping a quietly emptier station.
  if (plan.missing.length > 0) process.exitCode = 1;
}
