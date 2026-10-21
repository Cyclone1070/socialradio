import { contentKey, breakLinerKey, slug } from './keys';

describe('slug', () => {
  it('turns a title into a key segment', () => {
    expect(slug("We'll Be Right Back! (After This)")).toBe(
      'we-ll-be-right-back-after-this',
    );
  });

  it('keeps a key short enough to read and to serve', () => {
    expect(slug('a'.repeat(120))).toHaveLength(48);
  });
});

describe('contentKey', () => {
  it('names a file after what it is and what is in it', () => {
    const key = contentKey('music', 'Neon Waves', Buffer.from('one'));

    expect(key).toMatch(/^music\/neon-waves-[0-9a-f]{6}\.mp3$/);
  });

  it('gives a replaced file a new key, never the same one over new audio', () => {
    const before = contentKey('music', 'Neon Waves', Buffer.from('one'));
    const after = contentKey('music', 'Neon Waves', Buffer.from('two'));

    expect(after).not.toBe(before);
  });
});

describe('breakLinerKey', () => {
  it('names a break liner after its words, since the words are what it is', () => {
    expect(breakLinerKey("We'll be right back after this.")).toBe(
      'break_liners/we-ll-be-right-back-after-this.mp3',
    );
  });
});
