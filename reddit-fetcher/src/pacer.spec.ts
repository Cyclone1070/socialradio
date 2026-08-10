import { Pacer } from './pacer';

/**
 * The pacer owns TWO knobs — a random per-request delay (500–1000ms) and a
 * concurrency cap of 5 — while same-subreddit requests stay sequential (a
 * browser context can only do one thing).
 */
describe('Pacer', () => {
  it('serializes same-subreddit requests: the second starts only after the first completes', async () => {
    const pacer = new Pacer({ minDelayMs: 0, maxDelayMs: 0 });
    const order: string[] = [];

    const first = pacer.run('webdev', async () => {
      order.push('first-start');
      await new Promise((r) => setTimeout(r, 40));
      order.push('first-end');
    });
    await Promise.resolve(); // let the first request start

    const second = pacer.run('webdev', () => {
      order.push('second-start');
    });

    // While the first is still in flight, the second must not have started
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['first-start']);

    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second-start']);
  });

  it('runs at most 5 distinct subreddits concurrently; the 6th waits for a free slot', async () => {
    const pacer = new Pacer({ minDelayMs: 0, maxDelayMs: 0 });
    const active: string[] = [];
    let peak = 0;

    const work = async (sub: string) => {
      active.push(sub);
      peak = Math.max(peak, active.length);
      await new Promise((r) => setTimeout(r, 30));
      active.splice(active.indexOf(sub), 1);
    };

    const tasks = Array.from({ length: 6 }, (_, i) =>
      pacer.run(`sub${i}`, () => work(`sub${i}`)),
    );
    await Promise.all(tasks);

    expect(peak).toBe(5);
  });

  it('delays every request by min + rand*(max-min); rand=0 → 500ms, rand=1 → 1000ms', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    try {
      const pacer = new Pacer({ minDelayMs: 500, maxDelayMs: 1000 });
      const randSpy = jest.spyOn(Math, 'random');
      const starts: number[] = [];

      randSpy.mockReturnValueOnce(0).mockReturnValueOnce(1);
      const first = pacer.run('a', () => {
        starts.push(Date.now());
      });
      const second = pacer.run('b', () => {
        starts.push(Date.now());
      });

      await jest.advanceTimersByTimeAsync(500);
      expect(starts).toEqual([500]); // rand=0 → exactly 500ms, first request

      await jest.advanceTimersByTimeAsync(500);
      expect(starts).toEqual([500, 1000]); // rand=1 → exactly 1000ms, second request also delayed
      await Promise.all([first, second]);
    } finally {
      jest.useRealTimers();
    }
  });
});
