import { MoreCommentsTracker } from './more-comments';
import type { ResponseLike } from './more-comments';

function makeSource() {
  const handlers = new Set<(response: ResponseLike) => void>();
  return {
    on: jest.fn((_event: string, handler: (response: ResponseLike) => void) => {
      handlers.add(handler);
    }),
    off: jest.fn(
      (_event: string, handler: (response: ResponseLike) => void) => {
        handlers.delete(handler);
      },
    ),
    emit(url: string) {
      for (const handler of handlers) handler({ url: () => url });
    },
  };
}

describe('MoreCommentsTracker', () => {
  it('counts only more-comments responses', () => {
    const source = makeSource();
    const tracker = new MoreCommentsTracker(source);

    source.emit('https://www.reddit.com/svc/shreddit/more-comments/abc');
    source.emit('https://www.reddit.com/svc/shreddit/community-more-posts/top');
    source.emit('https://www.reddit.com/svc/shreddit/more-comments/def');

    expect(tracker.count).toBe(2);
  });

  it('resolves true once the expected responses arrive', async () => {
    const source = makeSource();
    const tracker = new MoreCommentsTracker(source);

    const pending = tracker.waitFor(2, 1_000, 5);
    source.emit('https://www.reddit.com/svc/shreddit/more-comments/a');
    source.emit('https://www.reddit.com/svc/shreddit/more-comments/b');

    await expect(pending).resolves.toBe(true);
  });

  it('resolves false on timeout and stops listening', async () => {
    const source = makeSource();
    const tracker = new MoreCommentsTracker(source);

    await expect(tracker.waitFor(1, 30, 5)).resolves.toBe(false);

    tracker.stop();
    source.emit('https://www.reddit.com/svc/shreddit/more-comments/a');
    expect(tracker.count).toBe(0);
  });
});
