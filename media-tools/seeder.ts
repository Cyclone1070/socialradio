/**
 * Makes the database agree with the library manifest: rows the manifest lists are
 * written, rows it no longer lists are removed.
 *
 * The manifest is the desired inventory and the rows are the actual one, so this
 * is a reconcile rather than a projection - running it twice changes nothing, and
 * a line deleted from the manifest stops being playable on the next run. Only the
 * rows are touched here; the object store is pruned separately, by namespace, so
 * that generated talk audio (which no row owns) is never swept up with it.
 *
 * It refuses to write a row for an object the bucket does not hold: a row
 * pointing at missing audio looks perfectly healthy until a listener reaches the
 * break it belongs to.
 */
import { LibraryEntry } from './manifest';

/** What the seeder needs from the database, expressed in the manifest's terms. */
export interface LibraryStore {
  stored(): Promise<LibraryEntry[]>;
  write(entry: LibraryEntry): Promise<void>;
  remove(key: string): Promise<void>;
}

/** What the seeder needs from the object store. */
export interface LibraryAudio {
  exists(key: string): Promise<boolean>;
}

export interface LibraryPlan {
  /** Entries with audio in the bucket and no row yet. */
  add: LibraryEntry[];
  /** Entries whose row disagrees with the manifest. */
  update: LibraryEntry[];
  /** Entries already written exactly as the manifest describes them. */
  unchanged: LibraryEntry[];
  /** Entries the bucket has no audio for, so no row is written. */
  missing: LibraryEntry[];
  /** Rows the manifest no longer lists, so the next run deletes them. */
  remove: LibraryEntry[];
}

const same = (a: LibraryEntry, b: LibraryEntry): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export class LibrarySeeder {
  constructor(
    private readonly store: LibraryStore,
    private readonly audio: LibraryAudio,
  ) {}

  async run(
    entries: LibraryEntry[],
    options: { dryRun: boolean },
  ): Promise<LibraryPlan> {
    const stored = new Map(
      (await this.store.stored()).map((entry) => [entry.key, entry]),
    );

    const plan: LibraryPlan = {
      add: [],
      update: [],
      unchanged: [],
      missing: [],
      remove: [],
    };
    for (const entry of entries) {
      if (!(await this.audio.exists(entry.key))) {
        plan.missing.push(entry);
        continue;
      }

      const row = stored.get(entry.key);
      if (!row) plan.add.push(entry);
      else if (same(row, entry)) plan.unchanged.push(entry);
      else plan.update.push(entry);
    }

    // A row whose key the manifest has dropped is a clip the library retired.
    const wanted = new Set(entries.map((entry) => entry.key));
    plan.remove = [...stored.values()].filter((row) => !wanted.has(row.key));

    if (!options.dryRun) {
      for (const entry of [...plan.add, ...plan.update]) {
        await this.store.write(entry);
      }
      for (const entry of plan.remove) {
        await this.store.remove(entry.key);
      }
    }
    return plan;
  }
}
