/**
 * Where the library lives on disk. The inventory and the words are committed;
 * the mirror of the audio is not, because the audio's home is the bucket.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  LibraryEntry,
  manifestDocument,
  parseLibraryManifest,
} from './manifest';

export function manifestPath(): string {
  return path.join('library', 'manifest.json');
}

export function linesPath(): string {
  return path.join('library', 'liner-lines.json');
}

export function readManifest(file = manifestPath()): LibraryEntry[] {
  if (!fs.existsSync(file)) return [];
  return parseLibraryManifest(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export function writeManifest(
  entries: LibraryEntry[],
  file = manifestPath(),
): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, manifestDocument(entries));
}

/** What the station says when it steps away from the conversation. */
export function readLines(file = linesPath()): string[] {
  const document: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    typeof document !== 'object' ||
    document === null ||
    !Array.isArray((document as { lines?: unknown }).lines)
  ) {
    throw new Error(`${file} must hold a list of lines`);
  }
  return (document as { lines: string[] }).lines;
}

export function argument(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}
