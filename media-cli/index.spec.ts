import { route } from './index';

describe('route', () => {
  it('matches each command to the work it names', () => {
    expect(route(['add', 'track.mp3', '--kind', 'music'])).toEqual({
      command: 'add',
      rest: ['track.mp3', '--kind', 'music'],
    });
    expect(route(['seed', '--dry-run'])).toEqual({
      command: 'seed',
      rest: ['--dry-run'],
    });
  });

  it('answers an unknown command with the usage rather than doing nothing', () => {
    expect(() => route(['frobnicate'])).toThrow(/usage/);
    expect(() => route([])).toThrow(/usage/);
  });
});
