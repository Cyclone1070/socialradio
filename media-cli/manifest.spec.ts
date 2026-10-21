import { manifestDocument, parseLibraryManifest, withEntry } from './manifest';

describe('parseLibraryManifest', () => {
  const music = {
    kind: 'music',
    key: 'music/neon-waves-8f2a1c.mp3',
    durationSeconds: 214.5,
    title: 'Neon Waves',
    artist: 'The Static',
  };

  it('reads the three pools out of one document', () => {
    const entries = parseLibraryManifest({
      version: 1,
      entries: [
        music,
        {
          kind: 'break_liner',
          key: 'break_liners/we-ll-be-right-back-4b1e9d.mp3',
          durationSeconds: 4.8,
          text: "We'll be right back after this.",
        },
        {
          kind: 'jingle',
          key: 'jingles/station-id-77c0aa.mp3',
          durationSeconds: 6.1,
          name: 'Station ID',
        },
      ],
    });

    expect(entries).toEqual([
      music,
      {
        kind: 'break_liner',
        key: 'break_liners/we-ll-be-right-back-4b1e9d.mp3',
        durationSeconds: 4.8,
        text: "We'll be right back after this.",
      },
      {
        kind: 'jingle',
        key: 'jingles/station-id-77c0aa.mp3',
        durationSeconds: 6.1,
        name: 'Station ID',
      },
    ]);
  });

  it('refuses a document from a format it does not know', () => {
    expect(() => parseLibraryManifest({ version: 2, entries: [] })).toThrow(
      /version/i,
    );
  });

  it('refuses two entries claiming the same object', () => {
    expect(() =>
      parseLibraryManifest({
        version: 1,
        entries: [music, { ...music, title: 'A different song' }],
      }),
    ).toThrow(/music\/neon-waves-8f2a1c\.mp3/);
  });

  it('refuses a duration the database would reject anyway', () => {
    expect(() =>
      parseLibraryManifest({
        version: 1,
        entries: [{ ...music, durationSeconds: 0 }],
      }),
    ).toThrow(/duration/i);
  });
});

describe('manifestDocument', () => {
  it('writes something this module reads back unchanged', () => {
    const entries = [
      {
        kind: 'break_liner' as const,
        key: 'break_liners/back-4b1e9d.mp3',
        durationSeconds: 4.8,
        text: 'We will be right back.',
      },
    ];

    expect(JSON.parse(manifestDocument(entries))).toEqual({
      version: 1,
      entries,
    });
  });
});

describe('withEntry', () => {
  it('replaces the entry for a key instead of listing the file twice', () => {
    const first = {
      kind: 'music' as const,
      key: 'music/a-111111.mp3',
      durationSeconds: 200,
      title: 'A',
      artist: 'X',
    };
    const second = { ...first, key: 'music/b-222222.mp3', title: 'B' };
    const corrected = { ...first, durationSeconds: 201 };

    expect(withEntry([first, second], corrected)).toEqual([corrected, second]);
  });
});
