import { withTimeout } from './timeout';

describe('withTimeout', () => {
  it('resolves with the promise value when it finishes in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 1_000, 'read')).resolves.toBe(
      7,
    );
  });

  it('rejects with a labelled error when the promise does not settle', async () => {
    jest.useFakeTimers();
    const pending = new Promise<never>(() => undefined);
    const result = withTimeout(pending, 1_000, 'read');

    jest.advanceTimersByTime(1_000);

    await expect(result).rejects.toThrow('read timed out');
    jest.useRealTimers();
  });
});
