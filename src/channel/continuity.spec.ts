import { buildDirective, continuityFor } from './continuity';

describe('what the next conversation is told', () => {
  it('opens the show when nothing has aired yet', () => {
    expect(continuityFor(null)).toBe('open-the-show');
    expect(buildDirective('open-the-show', null)).toContain(
      'first conversation',
    );
  });

  it('welcomes listeners back after a break', () => {
    expect(continuityFor({ type: 'music', outline: null })).toBe(
      'welcome-back',
    );
    expect(continuityFor({ type: 'liner', outline: null })).toBe(
      'welcome-back',
    );
    expect(buildDirective('welcome-back', null)).toContain('Welcome them back');
  });

  it('picks up the thread and quotes the outline it followed', () => {
    const previous = { type: 'talk', outline: '## STEP 1: COLD OPEN' };

    expect(continuityFor(previous)).toBe('pick-up-the-thread');
    expect(buildDirective('pick-up-the-thread', previous.outline)).toContain(
      '## STEP 1: COLD OPEN',
    );
  });

  it('does not claim a thread to pick up when the last conversation left no outline', () => {
    expect(continuityFor({ type: 'talk', outline: null })).toBe('welcome-back');
    expect(continuityFor({ type: 'talk', outline: '   ' })).toBe(
      'welcome-back',
    );
  });
});
