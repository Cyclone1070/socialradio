/**
 * The library manifest: what the station owns, in one reviewable document.
 *
 * The audio lives in an object store and the database holds a row per file, but
 * neither is where the library is authored. The manifest is: every entry names
 * an object key, the kind of thing it is, and the facts the row needs - above
 * all a duration, which the app image has no way to read out of an audio file.
 */
export const LIBRARY_MANIFEST_VERSION = 1;

export type LibraryKind = 'music' | 'liner' | 'jingle';

export interface MusicLibraryEntry {
  kind: 'music';
  key: string;
  durationSeconds: number;
  title: string;
  artist: string;
}

export interface LinerLibraryEntry {
  kind: 'liner';
  key: string;
  durationSeconds: number;
  text: string;
}

export interface JingleLibraryEntry {
  kind: 'jingle';
  key: string;
  durationSeconds: number;
  name: string;
}

export type LibraryEntry =
  MusicLibraryEntry | LinerLibraryEntry | JingleLibraryEntry;

function fail(message: string): never {
  throw new Error(`library manifest: ${message}`);
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${where} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${where} must be a non-empty string`);
  }
  return value.trim();
}

function duration(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(`${where} must be a number of seconds greater than zero`);
  }
  return value;
}

function entryOf(value: unknown, index: number): LibraryEntry {
  const source = record(value, `entry ${index}`);
  const where = `entry ${index}`;
  const key = text(source.key, `${where} key`);
  const durationSeconds = duration(source.durationSeconds, `${where} duration`);

  switch (source.kind) {
    case 'music':
      return {
        kind: 'music',
        key,
        durationSeconds,
        title: text(source.title, `${where} title`),
        artist: text(source.artist, `${where} artist`),
      };
    case 'liner':
      return {
        kind: 'liner',
        key,
        durationSeconds,
        text: text(source.text, `${where} text`),
      };
    case 'jingle':
      return {
        kind: 'jingle',
        key,
        durationSeconds,
        name: text(source.name, `${where} name`),
      };
    default:
      fail(
        `${where} kind must be music, liner or jingle, got ${JSON.stringify(source.kind)}`,
      );
  }
}

/** Reads a manifest document into the entries the seeder works from. */
export function parseLibraryManifest(document: unknown): LibraryEntry[] {
  const source = record(document, 'document');
  if (source.version !== LIBRARY_MANIFEST_VERSION) {
    fail(
      `version ${JSON.stringify(source.version)} is not supported, this build reads version ${LIBRARY_MANIFEST_VERSION}`,
    );
  }
  if (!Array.isArray(source.entries)) {
    fail('entries must be a list');
  }

  const entries = source.entries.map(entryOf);
  const seen = new Set<string>();
  for (const entry of entries) {
    // The row is keyed by the object key, so two entries claiming one object
    // would fight over the same row and the second would silently win.
    if (seen.has(entry.key)) {
      fail(`two entries claim ${entry.key}`);
    }
    seen.add(entry.key);
  }
  return entries;
}

/** Writes the entries back as the document this module reads. */
export function manifestDocument(entries: LibraryEntry[]): string {
  return `${JSON.stringify(
    { version: LIBRARY_MANIFEST_VERSION, entries },
    null,
    2,
  )}\n`;
}

/**
 * Adds an entry to the inventory, replacing whatever claimed that key before.
 * Sorted, so a diff shows the change rather than the order somebody typed it in.
 */
export function withEntry(
  entries: LibraryEntry[],
  entry: LibraryEntry,
): LibraryEntry[] {
  return [
    ...entries.filter((existing) => existing.key !== entry.key),
    entry,
  ].sort((a, b) => a.key.localeCompare(b.key));
}
