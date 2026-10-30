/**
 * The authoring tool for the station's media: songs, jingles and break liner
 * announcements.
 *
 * This is a dev tool, not part of the station. The library the station plays is a
 * row in the database plus an object in the bucket; the application reads those
 * two and nothing else, and would work with this folder deleted. What lives here
 * is the way media gets into that library.
 *
 *   npm run media -- add <file> --kind music --title ... --artist ...
 *   npm run media -- add <file> --kind jingle --name ...
 *   npm run media -- speak [--dry-run] [--count N]   line -> clip + row
 *   npm run media -- publish [--dry-run]             local mirror -> the bucket
 *   npm run media -- promote --from a --to b         bucket -> bucket, by manifest
 *   npm run media -- seed [--prune] [--dry-run]      the manifest -> the database
 *   npm run media -- remove --key <key> [--object] [--dry-run]
 *
 * The manifest under `library/` is the desired inventory and the database is the
 * actual one, which is what makes `seed` a reconcile: it writes what the manifest
 * lists and deletes rows it no longer lists. `speak` is the whole authoring flow
 * for a break liner, because a clip nobody can play is not added yet.
 *
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import {
  addMedia,
  promoteLibrary,
  removeMedia,
  publishLibrary,
  printSeedReport,
  seedLibrary,
  speakLibrary,
} from './commands';

dotenv.config();

export const USAGE = `usage: npm run media -- <command>

  add <file> --kind music --title <title> [--artist <artist>]
  add <file> --kind jingle --name <name>
  speak [--dry-run] [--count <n>]
  publish [--dry-run]
  promote --from <source bucket> --to <target bucket> [--dry-run]
  seed [--prune] [--dry-run]
  remove --key <key> [--object] [--dry-run]`;

export interface Routed {
  command: string;
  rest: string[];
}

/** Which command was asked for. Separate from running it, so it can be tested. */
export function route(argv: string[]): Routed {
  const [command, ...rest] = argv;
  if (
    !command ||
    !['add', 'speak', 'publish', 'promote', 'seed', 'remove'].includes(command)
  ) {
    throw new Error(USAGE);
  }
  return { command, rest };
}

async function main(argv: string[]): Promise<void> {
  const { command, rest } = route(argv.slice(2));

  switch (command) {
    case 'add':
      return addMedia(rest);
    case 'speak':
      return speakLibrary(rest);
    case 'publish':
      return publishLibrary(rest);
    case 'promote':
      return promoteLibrary(rest);
    case 'remove':
      return removeMedia(rest);
    default:
      return printSeedReport(await seedLibrary(rest));
  }
}

// Importing this file must not run a command: the specs import `route`.
if (require.main === module) {
  main(process.argv).catch((err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
