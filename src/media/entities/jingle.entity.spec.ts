import { Jingle } from './jingle.entity';

describe('Jingle', () => {
  it('enforces non-empty name, filePath, and durationSeconds > 0', () => {
    const jingle = new Jingle('  Station ID  ', '  jingles/id.mp3  ', 10);
    expect(jingle.name).toBe('Station ID');
    expect(jingle.filePath).toBe('jingles/id.mp3');
    expect(jingle.durationSeconds).toBe(10);

    expect(() => {
      new Jingle('   ', 'jingles/id.mp3', 10);
    }).toThrow('name cannot be empty');

    expect(() => {
      new Jingle('Station ID', 'jingles/id.mp3', 0);
    }).toThrow('durationSeconds must be > 0');
  });

  it('manages id and enforces read-only createdAt', () => {
    const jingle = new Jingle('ID', 'jingles/id.mp3', 10);
    expect(jingle.createdAt).toBeUndefined();

    const persistedDate = new Date('2026-01-01T00:00:00Z');
    const persisted = new Jingle(
      'ID',
      'jingles/id.mp3',
      10,
      'jingle-1',
      persistedDate,
    );
    expect(persisted.createdAt).toEqual(persistedDate);
    expect(persisted.id).toBe('jingle-1');
  });
});
