import { TalkSegment } from './segment.entity';

describe('TalkSegment outline', () => {
  it('keeps the outline the conversation was written from, and treats blank as absent', () => {
    const segment = new TalkSegment('cluster-1', 'ready');
    expect(segment.outline).toBeNull();

    segment.outline = '  ## STEP 1: COLD OPEN  ';
    expect(segment.outline).toBe('## STEP 1: COLD OPEN');

    segment.outline = '   ';
    expect(segment.outline).toBeNull();

    segment.outline = null;
    expect(segment.outline).toBeNull();
  });
});
