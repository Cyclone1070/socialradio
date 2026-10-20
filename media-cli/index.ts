/**
 * The media library's command surface. One subject - the inventory in
 * `library/manifest.json`, the audio it points at, and the rows that project
 * it - so the four operations live together rather than in four scripts.
 *
 *   npm run media -- add <file> --kind music --title ... --artist ...
 *   npm run media -- add <file> --kind jingle --name ...
 *   npm run media -- speak [--dry-run] [--count N]
 *   npm run media -- publish [--dry-run]      local mirror -> the bucket
 *   npm run media -- promote --from a --to b  bucket -> bucket, by manifest
 *   npm run media -- seed [--dry-run]         the manifest -> the database
 *
 * Authoring (`add`, `speak`) happens when the library changes. `publish` and
 * `promote` move audio. `seed` writes rows. Nothing here runs as part of the
 * station: the app only ever draws from what has already been seeded.
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import {
  addMedia,
  promoteLibrary,
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
  seed [--dry-run]`;

export interface Routed {
  command: string;
  rest: string[];
}

/** Which command was asked for. Separate from running it, so it can be tested. */
export function route(argv: string[]): Routed {
  const [command, ...rest] = argv;
  if (
    !command ||
    !['add', 'speak', 'publish', 'promote', 'seed'].includes(command)
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
