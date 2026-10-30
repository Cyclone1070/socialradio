/**
 * Where the library's inputs live on disk: `media-tools/library`, beside the tool
 * that reads them, because they are one subject.
 *
 * The inventory and the words are committed; the mirror of the audio is not,
 * because the audio's home is the bucket. Nothing here is read by the station -
 * the paths are resolved from this file's own location so the command works from
 * any directory, including a container.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  LibraryEntry,
  manifestDocument,
  parseLibraryManifest,
} from './manifest';

export function manifestPath(): string {
  return path.join(__dirname, 'library', 'manifest.json');
}

export function linesPath(): string {
  return path.join(__dirname, 'library', 'break-liner-lines.json');
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

/** Rewrites the pool of words, after a line has been retired. */
export function writeLines(lines: string[], file = linesPath()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, lines }, null, 2)}\n`);
}

export function argument(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}
