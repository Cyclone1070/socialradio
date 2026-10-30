import {
  addBreakLiners,
  entryFor,
  orphanKeys,
  removePlan,
  withoutLine,
  promotePlan,
  publishPlan,
  seedReport,
  speakPlan,
} from './commands';
import { LibraryEntry } from './manifest';

const song: LibraryEntry = {
  kind: 'music',
  key: 'music/neon-waves-8f2a1c.mp3',
  durationSeconds: 214.5,
  title: 'Neon Waves',
  artist: 'The Static',
};

const breakLiner: LibraryEntry = {
  kind: 'break_liner',
  key: 'break_liners/back-4b1e9d.mp3',
  durationSeconds: 4.8,
  text: 'We will be right back.',
};

describe('speakPlan', () => {
  it('speaks only the lines that have no clip yet', () => {
    const plan = speakPlan(
      ['We will be right back.', 'Hold that thought.'],
      [breakLiner],
      10,
    );

    expect(plan.lines).toEqual(['Hold that thought.']);
    expect(plan.recorded).toBe(1);
  });

  it('stops at the requested count, so a hundred clips can be spoken in batches', () => {
    const plan = speakPlan(['a', 'b', 'c'], [], 2);

    expect(plan.lines).toEqual(['a', 'b']);
  });
});

describe('publishPlan', () => {
  it('uploads what the bucket does not hold and counts the rest', () => {
    const plan = publishPlan([song, breakLiner], new Set([song.key]));

    expect(plan.toUpload).toEqual([breakLiner]);
    expect(plan.alreadyThere).toBe(1);
  });
});

describe('promotePlan', () => {
  it('copies what the target lacks from what the source holds', () => {
    const plan = promotePlan(
      [song, breakLiner],
      new Set([song.key]),
      new Set([song.key, breakLiner.key]),
    );

    expect(plan.toCopy).toEqual([breakLiner]);
    expect(plan.alreadyThere).toBe(1);
    expect(plan.absent).toEqual([]);
  });

  it('names the entries the source cannot supply', () => {
    const plan = promotePlan([song], new Set(), new Set());

    expect(plan.toCopy).toEqual([]);
    expect(plan.absent).toEqual([song.key]);
  });
});

describe('entryFor', () => {
  it('records a song with the length that was measured for it', () => {
    const entry = entryFor(
      'music',
      'Neon Waves',
      Buffer.from('one'),
      214.5,
      'The Static',
    );

    expect(entry).toMatchObject({
      kind: 'music',
      durationSeconds: 214.5,
      title: 'Neon Waves',
      artist: 'The Static',
    });
    expect(entry.key).toMatch(/^music\/neon-waves-[0-9a-f]{6}\.mp3$/);
  });

  it('records a jingle by its name', () => {
    const entry = entryFor('jingle', 'Station ID', Buffer.from('two'), 6.1);

    expect(entry).toMatchObject({ kind: 'jingle', durationSeconds: 6.1 });
    expect(entry.key).toMatch(/^jingles\/station-id-[0-9a-f]{6}\.mp3$/);
  });
});

describe('seedReport', () => {
  it('says what it would write and what has no audio', () => {
    const lines = seedReport({
      add: [song],
      update: [],
      unchanged: [breakLiner],
      missing: [breakLiner],
      remove: [breakLiner],
    });

    expect(lines[0]).toBe(
      '1 to add, 0 to correct, 1 already there, 1 to remove',
    );
    expect(lines.join('\n')).toContain('no longer in the manifest');
    expect(lines.join('\n')).toContain(song.key);
    expect(lines.join('\n')).toContain('has no audio in the bucket');
  });
});

describe('addBreakLiners', () => {
  const speaking = (duration: number) =>
    jest.fn((text: string) =>
      Promise.resolve({
        key: `break_liners/${text.length}.mp3`,
        durationSeconds: duration,
      }),
    );

  it('writes a clip and a row for every line it speaks', async () => {
    const speak = speaking(4.5);
    const record = jest.fn(() => Promise.resolve());
    const lines = ['We will be right back.', 'Short break, some music.'];

    const added = await addBreakLiners(lines, { speak, record });

    expect(added).toEqual([
      {
        kind: 'break_liner',
        key: 'break_liners/22.mp3',
        durationSeconds: 4.5,
        text: lines[0],
      },
      {
        kind: 'break_liner',
        key: 'break_liners/24.mp3',
        durationSeconds: 4.5,
        text: lines[1],
      },
    ]);
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledWith(added[0]);
    expect(record).toHaveBeenCalledWith(added[1]);
  });

  it('records nothing for a line the voice service refused', async () => {
    const speak = jest.fn(() => Promise.reject(new Error('engine down')));
    const record = jest.fn(() => Promise.resolve());

    await expect(
      addBreakLiners(['We will be right back.'], { speak, record }),
    ).rejects.toThrow('engine down');
    expect(record).not.toHaveBeenCalled();
  });
});

describe('removePlan', () => {
  it('names the entry to delete and leaves the rest of the inventory', () => {
    const plan = removePlan([song, breakLiner], breakLiner.key);

    expect(plan.entry).toEqual(breakLiner);
    expect(plan.remaining).toEqual([song]);
  });

  it('refuses a key the manifest does not list', () => {
    expect(() => removePlan([song], 'break_liners/nope.mp3')).toThrow(
      'break_liners/nope.mp3 is not in the manifest',
    );
  });
});

describe('withoutLine', () => {
  it('drops the words, so speaking the pool again cannot bring the clip back', () => {
    expect(
      withoutLine(['We will be right back.', 'Short break.'], 'Short break.'),
    ).toEqual(['We will be right back.']);
  });

  it('matches the line as written, ignoring surrounding space', () => {
    expect(withoutLine([' Short break. '], 'Short break.')).toEqual([]);
  });
});

describe('orphanKeys', () => {
  it('names library audio the manifest no longer lists', () => {
    expect(
      orphanKeys(
        [song, breakLiner],
        [song.key, breakLiner.key, 'break_liners/retired-1f2e3d.mp3'],
      ),
    ).toEqual(['break_liners/retired-1f2e3d.mp3']);
  });

  it('leaves audio the manifest does list alone', () => {
    expect(orphanKeys([song], [song.key])).toEqual([]);
  });
});
