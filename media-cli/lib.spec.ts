import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { argument, readLines, readManifest, writeManifest } from './lib';

describe('the library files on disk', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-cli-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads back a manifest it wrote', () => {
    const file = path.join(dir, 'manifest.json');
    const entries = [
      {
        kind: 'jingle' as const,
        key: 'jingle/station-id-77c0aa.mp3',
        durationSeconds: 6.1,
        name: 'Station ID',
      },
    ];

    writeManifest(entries, file);

    expect(readManifest(file)).toEqual(entries);
  });

  it('treats a missing manifest as an empty library rather than an error', () => {
    expect(readManifest(path.join(dir, 'nothing-here.json'))).toEqual([]);
  });

  it('refuses a lines file that is not a list of lines', () => {
    const file = path.join(dir, 'break-liner-lines.json');
    fs.writeFileSync(file, JSON.stringify({ words: ['no'] }));

    expect(() => readLines(file)).toThrow(/list of lines/);
  });

  it('reads the flag value that follows a name', () => {
    expect(argument(['add', 'file.mp3', '--kind', 'music'], '--kind')).toBe(
      'music',
    );
    expect(argument(['add', 'file.mp3'], '--kind')).toBeUndefined();
  });
});
