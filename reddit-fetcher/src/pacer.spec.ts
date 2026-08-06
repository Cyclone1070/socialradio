import { Pacer } from './pacer';

describe('Pacer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0); // delay = exactly 1000ms
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('fires the first request immediately and waits 1-2s before the next', async () => {
    const pacer = new Pacer();
    const order: string[] = [];

    const first = pacer.run(async () => {
      order.push('first');
    });
    await Promise.resolve(); // let the first request start

    const second = pacer.run(async () => {
      order.push('second');
    });

    // Before the 1s minimum delay elapses, the second must not have fired
    await jest.advanceTimersByTimeAsync(999);
    expect(order).toEqual(['first']);

    // At 1s after the first completed, the second fires
    await jest.advanceTimersByTimeAsync(1);
    expect(order).toEqual(['first', 'second']);

    await first;
    await second;
  });
});