/**
 * Puts the library manifest into the database, and only what the bucket can
 * actually serve.
 *
 * The row is a projection of the manifest, so running this twice writes nothing
 * the second time. It refuses to write a row for an object the bucket does not
 * hold: a row pointing at missing audio looks perfectly healthy until a listener
 * reaches the break it belongs to.
 */
import { LibraryEntry } from './manifest';

/** What the seeder needs from the database, expressed in the manifest's terms. */
export interface LibraryStore {
  stored(): Promise<LibraryEntry[]>;
  write(entry: LibraryEntry): Promise<void>;
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

    if (!options.dryRun) {
      for (const entry of [...plan.add, ...plan.update]) {
        await this.store.write(entry);
      }
    }
    return plan;
  }
}
