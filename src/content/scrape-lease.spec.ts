import {
  ScrapeLease,
  ClaimStore,
  CLAIM_LEASE_MS,
  RUN_CAP_MS,
} from './scrape-lease';

/**
 * The lease owns exactly two decisions: keep the claim alive while the run works,
 * and decide when the run must stop. Both are about time, so the clock is injected
 * rather than waited on - a test that sleeps cannot test a 30 minute cap.
 */
describe('ScrapeLease', () => {
  const store: jest.Mocked<ClaimStore> = {
    take: jest.fn(),
    renew: jest.fn(),
    release: jest.fn(),
  };
  const clock = { now: 1_000_000 };
  const now = () => clock.now;

  const take = (): Promise<ScrapeLease | null> =>
    ScrapeLease.take(store, 'sub-1', now, () => 'token-1');

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
      'sub-1',
      'token-1',
      new Date(clock.now - CLAIM_LEASE_MS),
    );
  });

  it('gives up when the statement matches no row, meaning someone else holds it', async () => {
    store.take.mockResolvedValue(0);

    await expect(take()).resolves.toBeNull();
  });

  it('renews its own claim and does not ask the run to stop', async () => {
    const lease = (await take())!;

    await expect(lease.beat()).resolves.toBeNull();

    expect(store.renew).toHaveBeenCalledWith(
      'sub-1',
      'token-1',
      new Date(clock.now),
    );
    expect(lease.shouldStop).toBe(false);
  });

  it('stops the run at its cap, and stops renewing so the claim can expire', async () => {
    const lease = (await take())!;
    clock.now += RUN_CAP_MS + 1;
    store.renew.mockClear();

    await expect(lease.beat()).resolves.toBe('time-cap');

    expect(lease.shouldStop).toBe(true);
    expect(lease.stopReason).toBe('time-cap');
    expect(store.renew).not.toHaveBeenCalled();
    await expect(lease.beat()).resolves.toBeNull();
    expect(store.renew).not.toHaveBeenCalled();
  });

  it('stops the run when a renewal shows the claim is no longer ours', async () => {
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

  it('releases only its own claim on the way out', async () => {
    const lease = (await take())!;

    await lease.stop();

    expect(store.release).toHaveBeenCalledWith('sub-1', 'token-1');
  });
});
