import { breakShape } from './break-shape';

describe('breakShape', () => {
  it('always announces the break, then plays one song', () => {
    expect(breakShape('talk', 'break')).toEqual(['liner', 'music']);
    expect(breakShape('music', 'break')).toEqual(['liner', 'music']);
  });

  it('announces the filler only when it interrupts something', () => {
    expect(breakShape('talk', 'filler')).toEqual(['liner', 'music', 'music']);
    expect(breakShape('jingle', 'filler')).toEqual(['liner', 'music', 'music']);
  });

  it('stays silent when the announcement would be information already heard', () => {
    expect(breakShape('music', 'filler')).toEqual(['music', 'music']);
    expect(breakShape('liner', 'filler')).toEqual(['music', 'music']);
    expect(breakShape(null, 'filler')).toEqual(['music', 'music']);
  });
});
