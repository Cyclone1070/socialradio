/**
 * The database side of seeding: reads what is stored and writes what the
 * manifest says should be.
 *
 * Rows are a projection of the manifest, keyed by the object key, so seeding is
 * an upsert rather than an insert. Nothing else in the schema points at these
 * tables - a segment carries its own copy of what it needs - which is what makes
 * correcting a row safe.
 */
import { EntityManager } from '@mikro-orm/postgresql';
import { Jingle } from '../src/media/entities/jingle.entity';
import { BreakLiner } from '../src/media/entities/break-liner.entity';
import { MusicTrack } from '../src/media/entities/music-track.entity';
import { LibraryEntry } from './manifest';
import { LibraryStore } from './seeder';

/** The three row types, told apart by the fields only they carry. */
export type LibraryRow = MusicTrack | BreakLiner | Jingle;

export function entryOf(row: LibraryRow): LibraryEntry {
  if (row instanceof MusicTrack) {
    return {
      kind: 'music',
      key: row.filePath,
      durationSeconds: row.durationSeconds,
      title: row.title,
      artist: row.artist,
    };
  }
  if (row instanceof BreakLiner) {
    return {
      kind: 'break_liner',
      key: row.filePath,
      durationSeconds: row.durationSeconds,
      text: row.text,
    };
  }
  return {
    kind: 'jingle',
    key: row.filePath,
    durationSeconds: row.durationSeconds,
    name: row.name,
  };
}

function rowFor(entry: LibraryEntry): LibraryRow {
  switch (entry.kind) {
    case 'music':
      return new MusicTrack(
        entry.title,
        entry.artist,
        entry.key,
        entry.durationSeconds,
      );
    case 'break_liner':
      return new BreakLiner(entry.text, entry.key, entry.durationSeconds);
    case 'jingle':
      return new Jingle(entry.name, entry.key, entry.durationSeconds);
  }
}

// Keyed by the manifest's kind, so the row a stored entry belongs in is the row
// the same kind writes.
const ROWS = {
  music: MusicTrack,
  break_liner: BreakLiner,
  jingle: Jingle,
} as const;

export class MikroLibraryStore implements LibraryStore {
  constructor(private readonly em: EntityManager) {}

  async stored(): Promise<LibraryEntry[]> {
    const [tracks, breakLiners, jingles] = await Promise.all([
      this.em.find(MusicTrack, {}),
      this.em.find(BreakLiner, {}),
      this.em.find(Jingle, {}),
    ]);
    return [...tracks, ...breakLiners, ...jingles].map(entryOf);
  }

  async write(entry: LibraryEntry): Promise<void> {
    // The key is unique, so a row already stored under it carries stale facts:
    // replace it rather than inserting beside it. Both statements go in one
    // transaction, so a failure cannot leave the library without the row.
    await this.em.transactional(async (em) => {
      await em.nativeDelete(ROWS[entry.kind], { filePath: entry.key });
      em.persist(rowFor(entry));
    });
  }
}
