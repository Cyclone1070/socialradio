import { ClaimLease, ClaimStore } from './claim-lease';

const TICK_MS = 30 * 1000;
const LEASE_MS = 3 * TICK_MS;
const CAP_MS = 10 * 60 * 1000;

/**
 * A lease owns exactly two decisions: keep the claim alive while the work runs, and
 * decide when the work must stop - because someone else took the claim, or because
 * it has been going long enough. Both are about time, so the clock is injected
 * rather than waited on; a test that sleeps cannot test a ten minute cap.
 *
 * The cap belongs to the caller: a scrape walk and a buffer batch are different
 * lengths of work, and neither should inherit the other's patience.
 */
describe('ClaimLease', () => {
  const store: jest.Mocked<ClaimStore> = {
    take: jest.fn(),
    renew: jest.fn(),
    release: jest.fn(),
  };
  const clock = { now: 1_000_000 };
  const now = () => clock.now;

  const take = (capMs = CAP_MS): Promise<ClaimLease | null> =>
    ClaimLease.take(store, 'row-1', {
      capMs,
      now,
      newToken: () => 'token-1',
    });

  beforeEach(() => {
    jest.clearAllMocks();
    clock.now = 1_000_000;
    store.take.mockResolvedValue(1);
    store.renew.mockResolvedValue(1);
    store.release.mockResolvedValue(undefined);
  });

  it('wins the claim by writing its own token against a stale-or-free row', async () => {
    const lease = await take();

    expect(lease?.token).toBe('token-1');
    expect(store.take).toHaveBeenCalledWith(
      'row-1',
      'token-1',
      new Date(clock.now - LEASE_MS),
    );
  });

  it('gives up when the statement matches no row, meaning someone else holds it', async () => {
    store.take.mockResolvedValue(0);

    await expect(take()).resolves.toBeNull();
  });

  it('renews its own claim and does not ask the work to stop', async () => {
    const lease = (await take())!;

    await expect(lease.beat()).resolves.toBeNull();

    expect(store.renew).toHaveBeenCalledWith(
      'row-1',
      'token-1',
      new Date(clock.now),
    );
    expect(lease.shouldStop).toBe(false);
  });

  it('stops the work at its cap, and stops renewing so the claim can expire', async () => {
    const lease = (await take())!;
    clock.now += CAP_MS + 1;
    store.renew.mockClear();

    await expect(lease.beat()).resolves.toBe('time-cap');

    expect(lease.shouldStop).toBe(true);
    expect(lease.stopReason).toBe('time-cap');
    expect(store.renew).not.toHaveBeenCalled();
    await expect(lease.beat()).resolves.toBeNull();
    expect(store.renew).not.toHaveBeenCalled();
  });

  it('honours the cap its caller asked for', async () => {
    const shortCap = 60 * 1000;
    const lease = (await take(shortCap))!;
    clock.now += shortCap + 1;

    await expect(lease.beat()).resolves.toBe('time-cap');
  });

  it('stops the work when a renewal shows the claim is no longer ours', async () => {
    const lease = (await take())!;
    store.renew.mockResolvedValue(0);

    await expect(lease.beat()).resolves.toBe('claim-lost');

    expect(lease.shouldStop).toBe(true);
    expect(lease.stopReason).toBe('claim-lost');
  });

  it('keeps the claim through a failed renewal, because a missed beat is not a lost one', async () => {
    const lease = (await take())!;
    store.renew.mockRejectedValueOnce(new Error('database is away'));

    await expect(lease.beat()).resolves.toBeNull();

    expect(lease.shouldStop).toBe(false);
    await expect(lease.beat()).resolves.toBeNull();
    expect(lease.shouldStop).toBe(false);
  });

  it('beats on its own while the work runs, and reports a lost claim only once', async () => {
    jest.useFakeTimers();
    try {
      const lease = (await take())!;
      store.renew.mockResolvedValue(0);
      const onStop = jest.fn();

      lease.start(onStop, TICK_MS);
      await jest.advanceTimersByTimeAsync(TICK_MS);

      expect(onStop).toHaveBeenCalledWith('claim-lost');
      await jest.advanceTimersByTimeAsync(4 * TICK_MS);
      expect(onStop).toHaveBeenCalledTimes(1);

      await lease.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it('releases only its own claim on the way out', async () => {
    const lease = (await take())!;

    await lease.stop();

    expect(store.release).toHaveBeenCalledWith('row-1', 'token-1');
  });
});
