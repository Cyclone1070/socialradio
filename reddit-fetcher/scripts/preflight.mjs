// Probes import from ../dist, so a stale build silently tests old code.
import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function ensureFreshBuild() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const srcDir = join(root, 'src');
  const entry = join(root, 'dist', 'server.js');

  let built;
  try {
    built = statSync(entry).mtimeMs;
  } catch {
    console.error('dist/server.js is missing: run `npm run build` first');
    process.exit(1);
  }

  const newest = Math.max(
    ...readdirSync(srcDir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      .map((file) => statSync(join(srcDir, file)).mtimeMs),
  );

  if (newest > built) {
    console.error('dist is stale: run `npm run build` before this probe');
    process.exit(1);
  }
}
