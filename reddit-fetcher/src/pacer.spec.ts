import { Pacer } from './pacer';

describe('Pacer', () => {
  it('fires the first request immediately and serializes every next', async () => {
    const pacer = new Pacer();
    const order: string[] = [];

    const first = pacer.run(async () => {
      order.push('first');
      await new Promise((r) => setTimeout(r, 50));
    });
    await Promise.resolve(); // let the first request start

    const second = pacer.run(async () => {
      order.push('second');
    });
    const third = pacer.run(async () => {
      order.push('third');
    });

    // While the first is still running, neither second nor third have fired
    await new Promise((r) => setTimeout(r, 25));
    expect(order).toEqual(['first']);

    // All later requests fire in order, immediately after the previous
    // completes — no artificial delay between them.
    await Promise.all([first, second, third]);
    expect(order).toEqual(['first', 'second', 'third']);
  });
});