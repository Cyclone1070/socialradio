import pino from 'pino';
import { BrowserSession } from './browser-session';

jest.mock('playwright-extra', () => ({
  chromium: { use: jest.fn(), connect: jest.fn() },
}));
jest.mock('puppeteer-extra-plugin-stealth', () => ({
  __esModule: true,
  default: jest.fn(() => ({})),
}));
jest.mock('fingerprint-generator', () => ({
  FingerprintGenerator: jest.fn().mockImplementation(() => ({
    getFingerprint: jest.fn(() => ({
      fingerprint: {
        navigator: { userAgent: 'test-ua', language: 'en-US' },
        screen: { width: 1920, height: 1080 },
      },
    })),
  })),
}));

const { chromium } = jest.requireMock<{
  chromium: { use: jest.Mock; connect: jest.Mock };
}>('playwright-extra');

const logger = pino({ level: 'silent' });

function makePage() {
  return {
    goto: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn().mockResolvedValue('ok'),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

function makeBrowser(page: ReturnType<typeof makePage>) {
  return {
    newContext: jest.fn().mockResolvedValue({
      newPage: jest.fn().mockResolvedValue(page),
      close: jest.fn().mockResolvedValue(undefined),
    }),
    close: jest.fn().mockResolvedValue(undefined),
    isConnected: jest.fn().mockReturnValue(true),
  };
}

describe('BrowserSession', () => {
  beforeEach(() => {
    chromium.connect.mockReset();
    chromium.use.mockReset();
  });

  it('connects once and reuses the browser and context', async () => {
    const page = makePage();
    chromium.connect.mockResolvedValue(makeBrowser(page));
    const session = new BrowserSession('ws://browserless:3000', logger);

    await session.withRetryOnDeadBrowser('webdev', (target) =>
      target.goto('https://www.reddit.com/r/webdev/'),
    );
    await session.withRetryOnDeadBrowser('webdev', (target) =>
      target.goto('https://www.reddit.com/r/webdev/top/'),
    );

    expect(chromium.connect).toHaveBeenCalledTimes(1);
    expect(chromium.connect).toHaveBeenCalledWith('ws://browserless:3000');
  });

  it('reconnects once when the session dies and retries the operation', async () => {
    const deadPage = makePage();
    deadPage.evaluate.mockRejectedValue(
      new Error('Target page, context or browser has been closed'),
    );
    const livePage = makePage();
    chromium.connect
      .mockResolvedValueOnce(makeBrowser(deadPage))
      .mockResolvedValueOnce(makeBrowser(livePage));
    const session = new BrowserSession('ws://browserless:3000', logger);

    await expect(
      session.withRetryOnDeadBrowser('webdev', (target) =>
        target.evaluate(() => 'value'),
      ),
    ).resolves.toBe('ok');

    expect(chromium.connect).toHaveBeenCalledTimes(2);
    expect(deadPage.close).toHaveBeenCalled();
  });

  it('reconnects once when browserless reports a request timeout', async () => {
    const deadPage = makePage();
    deadPage.evaluate.mockRejectedValue(new Error('Request has timed out'));
    const livePage = makePage();
    chromium.connect
      .mockResolvedValueOnce(makeBrowser(deadPage))
      .mockResolvedValueOnce(makeBrowser(livePage));
    const session = new BrowserSession('ws://browserless:3000', logger);

    await expect(
      session.withRetryOnDeadBrowser('webdev', (target) =>
        target.evaluate(() => 'value'),
      ),
    ).resolves.toBe('ok');

    expect(chromium.connect).toHaveBeenCalledTimes(2);
  });

  it('retries a transient evaluate error three times, then throws', async () => {
    const page = makePage();
    page.evaluate.mockRejectedValue(new Error('evaluate failed'));
    chromium.connect.mockResolvedValue(makeBrowser(page));
    const session = new BrowserSession('ws://browserless:3000', logger);

    await expect(
      session.withRetryOnDeadBrowser('webdev', (target) =>
        session.evaluateSafely(target, () => 'value'),
      ),
    ).rejects.toThrow('evaluate failed');

    expect(page.evaluate).toHaveBeenCalledTimes(3);
  });

  it('does not retry a closed-browser error inside evaluateSafely', async () => {
    const page = makePage();
    page.evaluate.mockRejectedValue(new Error('browser has been closed'));
    chromium.connect.mockResolvedValue(makeBrowser(page));
    const session = new BrowserSession('ws://browserless:3000', logger);

    await expect(
      session.withRetryOnDeadBrowser('webdev', (target) =>
        session.evaluateSafely(target, () => 'value'),
      ),
    ).rejects.toThrow(/closed/);

    // evaluateSafely rethrows immediately; the outer policy reconnects once.
    expect(page.evaluate).toHaveBeenCalledTimes(2);
    expect(chromium.connect).toHaveBeenCalledTimes(2);
  });

  it('exposes a hard quota floor and clears it on rotation', async () => {
    const page = makePage();
    chromium.connect.mockResolvedValue(makeBrowser(page));
    const session = new BrowserSession('ws://browserless:3000', logger);

    session.noteQuota('webdev', 9);
    expect(session.isQuotaExhausted('webdev')).toBe(true);
    await session.rotateContext('webdev');
    expect(session.isQuotaExhausted('webdev')).toBe(false);
  });

  it('rotates to a fresh context when the quota is low', async () => {
    const firstPage = makePage();
    const secondPage = makePage();
    const firstContext = {
      newPage: jest.fn().mockResolvedValue(firstPage),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const secondContext = {
      newPage: jest.fn().mockResolvedValue(secondPage),
      close: jest.fn().mockResolvedValue(undefined),
    };
    chromium.connect.mockResolvedValue({
      newContext: jest
        .fn()
        .mockResolvedValueOnce(firstContext)
        .mockResolvedValueOnce(secondContext),
      close: jest.fn().mockResolvedValue(undefined),
    });
    const session = new BrowserSession('ws://browserless:3000', logger);

    await session.withRetryOnDeadBrowser('webdev', (target) =>
      target.goto('https://www.reddit.com/r/webdev/'),
    );
    session.noteQuota('webdev', '10');
    await session.withRetryOnDeadBrowser('webdev', (target) =>
      target.goto('https://www.reddit.com/r/webdev/'),
    );

    expect(firstContext.close).toHaveBeenCalled();
    expect(secondContext.newPage).toHaveBeenCalled();
  });

  it('retries once on a fresh context after a 429', async () => {
    const firstPage = makePage();
    firstPage.goto.mockRejectedValueOnce(
      new Error('reddit comment page HTTP 429'),
    );
    const secondPage = makePage();
    const firstContext = {
      newPage: jest.fn().mockResolvedValue(firstPage),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const secondContext = {
      newPage: jest.fn().mockResolvedValue(secondPage),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const newContext = jest
      .fn()
      .mockResolvedValueOnce(firstContext)
      .mockResolvedValueOnce(secondContext);
    chromium.connect.mockResolvedValue({
      newContext,
      close: jest.fn().mockResolvedValue(undefined),
    });
    const session = new BrowserSession('ws://browserless:3000', logger);

    await expect(
      session.withRetryOnDeadBrowser('webdev', (target) =>
        target.goto('https://www.reddit.com/r/webdev/comments/abc/'),
      ),
    ).resolves.toBeUndefined();

    expect(newContext).toHaveBeenCalledTimes(2);
    expect(firstContext.close).toHaveBeenCalled();
    expect(secondPage.goto).toHaveBeenCalled();
  });

  it('closes the page after the operation, even when it throws', async () => {
    const page = makePage();
    chromium.connect.mockResolvedValue(makeBrowser(page));
    const session = new BrowserSession('ws://browserless:3000', logger);

    await expect(
      session.withRetryOnDeadBrowser('webdev', () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(page.close).toHaveBeenCalled();
  });
});
