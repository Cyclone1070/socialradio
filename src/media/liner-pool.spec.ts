import { BREAK_LINERS, planLinerSeed } from './liner-pool';

describe('the liner pool', () => {
  it('holds at least a hundred different things to say', () => {
    expect(BREAK_LINERS.length).toBeGreaterThanOrEqual(100);
    expect(new Set(BREAK_LINERS.map((line) => line.trim())).size).toBe(
      BREAK_LINERS.length,
    );
    expect(BREAK_LINERS.every((line) => line.trim().length > 0)).toBe(true);
  });
});

describe('seeding the pool', () => {
  it('takes the first lines it has not already stored', () => {
    const plan = planLinerSeed([], 3);

    expect(plan).toEqual(BREAK_LINERS.slice(0, 3));
  });

  it('skips what is already stored, however it was typed', () => {
    const stored = [BREAK_LINERS[0].toUpperCase(), `  ${BREAK_LINERS[1]}  `];

    const plan = planLinerSeed(stored, 2);

    expect(plan).toEqual(BREAK_LINERS.slice(2, 4));
  });

  it('is asked for nothing, and stores nothing', () => {
    expect(planLinerSeed([], 0)).toEqual([]);
  });

  it('runs out of things to say rather than repeating itself', () => {
    const plan = planLinerSeed(BREAK_LINERS.slice(0, 2), BREAK_LINERS.length);

    expect(plan).toHaveLength(BREAK_LINERS.length - 2);
    expect(new Set(plan).size).toBe(plan.length);
  });
});
