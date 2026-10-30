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
  writeLines,
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
    `${plan.add.length} to add, ${plan.update.length} to correct, ${plan.unchanged.length} already there, ${plan.remove.length} to remove`,
  ];
  for (const entry of plan.add) {
    lines.push(`  + ${entry.key} (${entry.kind}, ${entry.durationSeconds}s)`);
  }
  for (const entry of plan.update) {
    lines.push(`  ~ ${entry.key} (${entry.kind}, ${entry.durationSeconds}s)`);
  }
  for (const entry of plan.remove) {
    lines.push(`  - ${entry.key} (${entry.kind}) is no longer in the manifest`);
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

/**
 * Where library audio lives in a bucket. Generated talk audio is under `audio/`,
 * so these prefixes are what separates media the manifest owns from the show's
 * own output - sweeping the whole bucket would delete the programme.
 */
export const LIBRARY_PREFIXES = ['music/', 'jingles/', 'break_liners/'];

/** Objects under the library prefixes that no manifest entry claims. */
export function orphanKeys(
  entries: readonly LibraryEntry[],
  keys: readonly string[],
): string[] {
  const claimed = new Set(entries.map((entry) => entry.key));
  return keys.filter((key) => !claimed.has(key));
}

/** An entry to delete, and the inventory without it. */
export interface RemovalPlan {
  entry: LibraryEntry;
  remaining: LibraryEntry[];
}

/**
 * Deleting is removing the manifest entry; the reconcile then removes the row and
 * the object. Resolving the key here means a typo fails before anything is
 * touched, rather than deleting nothing and reporting success.
 */
export function removePlan(
  entries: readonly LibraryEntry[],
  key: string,
): RemovalPlan {
  const entry = entries.find((candidate) => candidate.key === key);
  if (!entry) throw new Error(`${key} is not in the manifest`);
  return {
    entry,
    remaining: entries.filter((candidate) => candidate.key !== key),
  };
}

/**
 * The words without the retired line. A break liner's clip is named after its
 * words, so leaving the line in the pool would speak it straight back on the
 * next run - deleting the row would look like it had been ignored.
 */
export function withoutLine(lines: readonly string[], text: string): string[] {
  return lines.filter((line) => line.trim() !== text.trim());
}

/** What speaking a line produces, and what has to be written for it. */
export interface LinerDeps {
  speak(text: string): Promise<{ key: string; durationSeconds: number }>;
  record(entry: LibraryEntry): Promise<void>;
}

/**
 * One line becomes one clip and one row, in that order, together.
 *
 * The station plays from rows, so a clip without a row is invisible and a row
 * without a clip is a 404 in the middle of a break. Sequencing them here means a
 * caller cannot do the one without the other, and a failure to speak records
 * nothing rather than a row pointing at audio that never uploaded.
 */
export async function addBreakLiners(
  lines: readonly string[],
  deps: LinerDeps,
): Promise<LibraryEntry[]> {
  const added: LibraryEntry[] = [];
  for (const line of lines) {
    const track = await deps.speak(line);
    const entry: LibraryEntry = {
      kind: 'break_liner',
      key: track.key,
      durationSeconds: track.durationSeconds,
      text: line,
    };
    await deps.record(entry);
    added.push(entry);
  }
  return added;
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
  const orm = await MikroORM.init(mikroOrmConfig);
  try {
    const store = new MikroLibraryStore(orm.em.fork());
    const added = await addBreakLiners(unspoken, {
      // The station's voice, not a host's: a break announcement is the station
      // talking, and it should not sound like the person who just left the room.
      speak: async (line) => {
        const key = breakLinerKey(line);
        const track = await audio.synthesizeScript(
          { postId: key, turns: [{ speaker: 'Station', text: line }] },
          key,
        );
        return { key, durationSeconds: track.durationSeconds };
      },
      // The row is what the station plays from, so it is written in the same run
      // as the clip. The manifest records the same fact for the next deploy.
      record: (entry) => store.write(entry),
    });

    let recorded = entries;
    for (const entry of added) {
      recorded = withEntry(recorded, entry);
      process.stdout.write(`  ${entry.key} (${entry.durationSeconds}s)\n`);
    }
    writeManifest(recorded);
    process.stdout.write(
      `${added.length} clip(s) and row(s) written, manifest updated\n`,
    );
  } finally {
    await orm.close(true);
  }
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

/**
 * Makes the library agree with the manifest: rows in the database, and - with
 * `--prune` - objects in the bucket.
 *
 * The manifest is the desired inventory and the database is the actual one, so
 * this reconciles rather than projects: entries it lists are written, rows it no
 * longer lists are removed. Pruning is a separate flag because deleting audio is
 * destructive, and it is scoped by prefix so the show's own output is never
 * touched.
 */
export async function seedLibrary(argv: string[]): Promise<LibraryPlan> {
  const dryRun = argv.includes('--dry-run');
  const prune = argv.includes('--prune');
  const entries = readManifest();
  const orm = await MikroORM.init(mikroOrmConfig);
  try {
    const seeder = new LibrarySeeder(
      new MikroLibraryStore(orm.em.fork()),
      storageFor(),
    );
    const plan = await seeder.run(entries, { dryRun });
    if (prune) await pruneLibrary(entries, { dryRun });
    return plan;
  } finally {
    await orm.close(true);
  }
}

/** Deletes library audio no manifest entry claims. */
async function pruneLibrary(
  entries: readonly LibraryEntry[],
  options: { dryRun: boolean },
): Promise<void> {
  const storage = storageFor();
  for (const prefix of LIBRARY_PREFIXES) {
    const keys = await storage.listKeys(prefix);
    const orphans = orphanKeys(entries, keys);
    for (const key of orphans) {
      process.stdout.write(`  - ${key} (no manifest entry)\n`);
      if (!options.dryRun) await storage.delete(key);
    }
  }
}

/**
 * Retires a clip: the manifest entry, the row, and - if asked - the object.
 *
 * The row goes first because it is what the station plays from, so the clip stops
 * airing even if a later step fails. The words go too when the clip is a break
 * liner: the pool is the authoring input, and a line left in it would be spoken
 * straight back on the next run.
 */
export async function removeMedia(argv: string[]): Promise<void> {
  const key = argument(argv, '--key');
  if (!key) throw new Error('--key is required');
  const dryRun = argv.includes('--dry-run');
  const withObject = argv.includes('--object');

  const plan = removePlan(readManifest(), key);
  const lines =
    plan.entry.kind === 'break_liner'
      ? withoutLine(readLines(), plan.entry.text)
      : null;

  process.stdout.write(`- ${plan.entry.key} (${plan.entry.kind})\n`);
  if (lines) process.stdout.write(`  its line leaves the pool of words\n`);
  if (withObject) process.stdout.write(`  the object goes from the bucket\n`);
  if (dryRun) {
    process.stdout.write('dry run: nothing deleted\n');
    return;
  }

  const orm = await MikroORM.init(mikroOrmConfig);
  try {
    await new MikroLibraryStore(orm.em.fork()).remove(key);
  } finally {
    await orm.close(true);
  }
  if (withObject) await storageFor().delete(key);
  writeManifest(plan.remaining);
  if (lines) writeLines(lines);
  process.stdout.write('row deleted, manifest updated\n');
}

export function printSeedReport(plan: LibraryPlan): void {
  for (const line of seedReport(plan)) process.stdout.write(`${line}\n`);
  // A row is never written for audio the bucket does not hold: say so loudly
  // enough that a deploy stops rather than shipping a quietly emptier station.
  if (plan.missing.length > 0) process.exitCode = 1;
}
