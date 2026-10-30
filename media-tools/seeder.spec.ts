import { LibraryEntry } from './manifest';
import { LibrarySeeder, LibraryStore } from './seeder';

describe('LibrarySeeder', () => {
  const music: LibraryEntry = {
    kind: 'music',
    key: 'music/neon-waves-8f2a1c.mp3',
    durationSeconds: 214.5,
    title: 'Neon Waves',
    artist: 'The Static',
  };

  class FakeStore implements LibraryStore {
    readonly written: LibraryEntry[] = [];
    readonly removed: string[] = [];

    constructor(private rows: LibraryEntry[] = []) {}

    stored(): Promise<LibraryEntry[]> {
      return Promise.resolve(this.rows);
    }

    remove(key: string): Promise<void> {
      this.removed.push(key);
      this.rows = this.rows.filter((row) => row.key !== key);
      return Promise.resolve();
    }

    write(entry: LibraryEntry): Promise<void> {
      this.written.push(entry);
      this.rows = [...this.rows.filter((row) => row.key !== entry.key), entry];
      return Promise.resolve();
    }
  }

  const retired: LibraryEntry = {
    kind: 'break_liner',
    key: 'break_liners/retired-1f2e3d.mp3',
    durationSeconds: 5.2,
    text: 'A line we no longer want.',
  };

  const audioWith = (...keys: string[]) => ({
    exists: (key: string) => Promise.resolve(keys.includes(key)),
  });

  it('never writes a row for audio the bucket does not have', async () => {
    const store = new FakeStore();
    const seeder = new LibrarySeeder(store, audioWith());

    const plan = await seeder.run([music], { dryRun: false });

    expect(plan.missing).toEqual([music]);
    expect(store.written).toEqual([]);
  });

  it('leaves a row that already matches the manifest alone', async () => {
    const store = new FakeStore([music]);
    const seeder = new LibrarySeeder(store, audioWith(music.key));

    const plan = await seeder.run([music], { dryRun: false });

    expect(plan.unchanged).toEqual([music]);
    expect(store.written).toEqual([]);
  });

  it('corrects a row that disagrees with the manifest', async () => {
    const store = new FakeStore([{ ...music, durationSeconds: 5 }]);
    const seeder = new LibrarySeeder(store, audioWith(music.key));

    const plan = await seeder.run([music], { dryRun: false });

    expect(plan.update).toEqual([music]);
    expect(store.written).toEqual([music]);
  });

  it('writes nothing at all on a dry run', async () => {
    const store = new FakeStore();
    const seeder = new LibrarySeeder(store, audioWith(music.key));

    const plan = await seeder.run([music], { dryRun: true });

    expect(plan.add).toEqual([music]);
    expect(store.written).toEqual([]);
  });

  it('removes the rows the manifest no longer lists', async () => {
    const store = new FakeStore([music, retired]);
    const seeder = new LibrarySeeder(store, audioWith(music.key));

    const plan = await seeder.run([music], { dryRun: false });

    expect(plan.remove).toEqual([retired]);
    expect(store.removed).toEqual([retired.key]);
  });

  it('shows a removal on a dry run without doing it', async () => {
    const store = new FakeStore([music, retired]);
    const seeder = new LibrarySeeder(store, audioWith(music.key));

    const plan = await seeder.run([music], { dryRun: true });

    expect(plan.remove).toEqual([retired]);
    expect(store.removed).toEqual([]);
  });
});
