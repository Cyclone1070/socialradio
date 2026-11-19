import {
  planContinuationOpen,
  planSelectorWait,
  planSubCollection,
} from './continuation-budget';

describe('planContinuationOpen', () => {
  it('refuses to open a page with less than eight seconds left', () => {
    expect(planContinuationOpen(100_000, 92_001)).toEqual({
      open: false,
      gotoTimeoutMs: 0,
    });
  });

  it('opens at exactly eight seconds and clamps the goto timeout', () => {
    expect(planContinuationOpen(100_000, 92_000)).toEqual({
      open: true,
      gotoTimeoutMs: 5_000,
    });
    expect(planContinuationOpen(100_000, 80_000).gotoTimeoutMs).toBe(14_000);
    expect(planContinuationOpen(100_000, 10_000).gotoTimeoutMs).toBe(30_000);
  });
});

describe('planSelectorWait', () => {
  it('skips the selector wait below five seconds', () => {
    expect(planSelectorWait(100_000, 95_001)).toEqual({
      wait: false,
      timeoutMs: 0,
    });
  });

  it('clamps the selector timeout', () => {
    expect(planSelectorWait(100_000, 95_000).timeoutMs).toBe(2_000);
    expect(planSelectorWait(100_000, 90_000).timeoutMs).toBe(6_000);
    expect(planSelectorWait(100_000, 80_000).timeoutMs).toBe(10_000);
  });
});

describe('planSubCollection', () => {
  it('skips collection when less than three seconds remain', () => {
    expect(planSubCollection(100_000, 96_001)).toEqual({
      collect: false,
      budgetMs: 0,
    });
  });

  it('returns the remaining budget above the floor', () => {
    expect(planSubCollection(100_000, 94_000)).toEqual({
      collect: true,
      budgetMs: 3_000,
    });
    expect(planSubCollection(100_000, 80_000)).toEqual({
      collect: true,
      budgetMs: 17_000,
    });
  });
});
