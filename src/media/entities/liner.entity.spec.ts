import { Liner } from './liner.entity';

describe('Liner', () => {
  it('trims the spoken text and rejects an empty one', () => {
    const liner = new Liner(
      '  We will be right back.  ',
      'liners/back-01.mp3',
      4.2,
    );
    expect(liner.text).toBe('We will be right back.');
    expect(liner.filePath).toBe('liners/back-01.mp3');
    expect(liner.durationSeconds).toBe(4.2);

    expect(() => new Liner('   ', 'liners/back-01.mp3', 4.2)).toThrow(
      'text cannot be empty',
    );
  });

  it('rejects a blank file path and a non-positive duration', () => {
    expect(() => new Liner('We will be right back.', '  ', 4.2)).toThrow(
      'filePath cannot be empty',
    );

    expect(
      () => new Liner('We will be right back.', 'liners/back-01.mp3', 0),
    ).toThrow('durationSeconds must be > 0');

    expect(
      () => new Liner('We will be right back.', 'liners/back-01.mp3', -1),
    ).toThrow('durationSeconds must be > 0');
  });
});
