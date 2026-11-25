import { JSDOM } from 'jsdom';
import { parseCommentTree } from './comments';
import {
  clickMoreReplies,
  clickMoreRepliesBatch,
  findVisibleContinuationLinks,
  findContinuationLinks,
  readCommentCount,
  readCommentTree,
  readExpectedCommentCount,
  isForbiddenPage,
  isRedditChallengeUrl,
  readPostFeed,
  waitForCommentGrowth,
  waitForCommentGrowthCount,
  waitForPostGrowth,
  waitForStableTree,
} from './dom';

const doc = (html: string) => new JSDOM(html).window.document;

describe('readCommentCount', () => {
  it('counts rendered comments without serializing the tree', () => {
    const document = doc(
      '<div id="comment-tree"><shreddit-comment></shreddit-comment><shreddit-comment></shreddit-comment></div>',
    );

    expect(readCommentCount(document)).toBe(2);
  });
});

describe('readCommentTree', () => {
  it('includes comments rendered outside #comment-tree', () => {
    const document = doc(
      '<div id="comment-tree"><shreddit-comment thingid="t1_a"><div slot="comment">a</div></shreddit-comment></div><shreddit-comment thingid="t1_b"><div slot="comment">b</div></shreddit-comment>',
    );

    const snapshot = readCommentTree(document);

    expect(snapshot.count).toBe(2);
    expect(parseCommentTree(snapshot.html).map((c) => c.thingId)).toEqual([
      't1_a',
      't1_b',
    ]);
  });

  it('reads a continuation page that has comments but no #comment-tree', () => {
    const document = doc(
      '<shreddit-comment thingid="t1_a"><div slot="comment">a</div><shreddit-comment thingid="t1_b"><div slot="comment">b</div></shreddit-comment></shreddit-comment>',
    );

    const snapshot = readCommentTree(document);

    expect(snapshot.count).toBe(2);
    expect(parseCommentTree(snapshot.html).map((c) => c.thingId)).toEqual([
      't1_a',
      't1_b',
    ]);
  });

  it('returns the comment tree html and the rendered comment count', () => {
    const html =
      '<div id="comment-tree"><shreddit-comment thingid="t1_a"></shreddit-comment><shreddit-comment thingid="t1_b"></shreddit-comment></div>';

    expect(readCommentTree(doc(html))).toEqual({
      html: '<shreddit-comment thingid="t1_a"></shreddit-comment><shreddit-comment thingid="t1_b"></shreddit-comment>',
      count: 2,
    });
  });

  it('treats an empty comment tree as a thread with no comments', () => {
    expect(readCommentTree(doc('<div id="comment-tree"></div>'))).toEqual({
      html: '',
      count: 0,
    });
  });

  it('throws when the comment tree did not render', () => {
    expect(() => readCommentTree(doc('<main></main>'))).toThrow(
      /comment tree not rendered/,
    );
    expect(() =>
      readCommentTree(doc('<shreddit-post></shreddit-post>')),
    ).toThrow(/comment tree not rendered/);
  });
});

describe('clickMoreReplies', () => {
  it('clicks the first "more replies" button and reports it', () => {
    const document = doc(
      '<button>Hide</button><button>48 more replies</button><button>11 more replies</button>',
    );
    let clicked = 0;
    document.querySelectorAll('button')[1].addEventListener('click', () => {
      clicked += 1;
    });

    expect(clickMoreReplies(document)).toBe(true);
    expect(clicked).toBe(1);
  });

  it('reports false when there is no expansion button', () => {
    expect(clickMoreReplies(doc('<button>Hide</button>'))).toBe(false);
  });

  it('ignores anchors that navigate to a continuation page', () => {
    const document = doc(
      '<a href="/r/x/comments/p/comment/c/?force-legacy-sct=1">48 more replies</a>',
    );

    expect(clickMoreReplies(document)).toBe(false);
  });
});

describe('clickMoreRepliesBatch', () => {
  it('clicks up to the batch size and can re-click a still-present control', () => {
    const document = doc(
      '<button>3 more replies</button><button>4 more replies</button><button>5 more replies</button>',
    );
    let clicks = 0;
    for (const button of document.querySelectorAll('button')) {
      button.addEventListener('click', () => {
        clicks += 1;
      });
    }

    expect(clickMoreRepliesBatch({ maxClicks: 2 }, document)).toBe(2);
    expect(clickMoreRepliesBatch({ maxClicks: 2 }, document)).toBe(2);
    expect(clicks).toBe(4);
  });

  it('scrolls an off-screen control into view before clicking it', () => {
    const document = doc('<button>5 more replies</button>');
    const button = document.querySelector('button')!;
    const scrollIntoView = jest.fn();
    button.scrollIntoView = scrollIntoView;
    button.getBoundingClientRect = () =>
      ({ top: 2_000, bottom: 2_020 }) as DOMRect;

    clickMoreRepliesBatch({ maxClicks: 1 }, document);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  });

  it('scrolls a visible control too, to wake lazy rendering', () => {
    const document = doc('<button>5 more replies</button>');
    const button = document.querySelector('button')!;
    const scrollIntoView = jest.fn();
    button.scrollIntoView = scrollIntoView;
    button.getBoundingClientRect = () => ({ top: 100, bottom: 120 }) as DOMRect;

    clickMoreRepliesBatch({ maxClicks: 1 }, document);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  });

  it('ignores anchors but re-clicks a button even if it was clicked before', () => {
    const document = doc(
      '<a href="/x?force-legacy-sct=1">3 more replies</a><button data-qa-clicked-at="4 more replies">4 more replies</button>',
    );

    expect(clickMoreRepliesBatch({ maxClicks: 5 }, document)).toBe(1);
  });

  it('re-clicks a reused button whose label changed', () => {
    const document = doc('<button>5 more replies</button>');

    expect(clickMoreRepliesBatch({ maxClicks: 5 }, document)).toBe(1);
    document.querySelector('button')!.textContent = '2 more replies';
    expect(clickMoreRepliesBatch({ maxClicks: 5 }, document)).toBe(1);
    expect(clickMoreRepliesBatch({ maxClicks: 5 }, document)).toBe(1);
  });
});

describe('findVisibleContinuationLinks', () => {
  it('returns only visible anchors, deduped by href', () => {
    const document = doc(`
      <shreddit-comment thingid="t1_a">
        <a href="/r/x/comments/p/comment/a/?force-legacy-sct=1">3 more replies</a>
        <a href="/r/x/comments/p/comment/a/?force-legacy-sct=1">3 more replies</a>
      </shreddit-comment>
      <shreddit-comment thingid="t1_b">
        <a href="/r/x/comments/p/comment/b/?force-legacy-sct=1">2 more replies</a>
      </shreddit-comment>
    `);
    const anchors = [...document.querySelectorAll('a')];
    Object.defineProperty(anchors[0], 'offsetWidth', { value: 40 });
    Object.defineProperty(anchors[1], 'offsetWidth', { value: 40 });
    Object.defineProperty(anchors[2], 'offsetWidth', { value: 0 });
    Object.defineProperty(anchors[2], 'offsetHeight', { value: 0 });

    expect(findVisibleContinuationLinks(document)).toEqual([
      {
        href: '/r/x/comments/p/comment/a/?force-legacy-sct=1',
        ownerId: 't1_a',
        depth: 0,
        more: 3,
      },
    ]);
  });
});

describe('findContinuationLinks', () => {
  it('returns unique hrefs with the owning comment id', () => {
    const html = `
      <shreddit-comment thingid="t1_a">
        <a href="/r/x/comments/p/comment/a/?force-legacy-sct=1">48 more replies</a>
      </shreddit-comment>
      <shreddit-comment thingid="t1_b">
        <a href="/r/x/comments/p/comment/b/?force-legacy-sct=1">11 more replies</a>
        <a href="/r/x/comments/p/comment/b/?force-legacy-sct=1">11 more replies</a>
      </shreddit-comment>`;

    expect(findContinuationLinks(doc(html))).toEqual([
      {
        href: '/r/x/comments/p/comment/a/?force-legacy-sct=1',
        ownerId: 't1_a',
        depth: 0,
        more: 48,
      },
      {
        href: '/r/x/comments/p/comment/b/?force-legacy-sct=1',
        ownerId: 't1_b',
        depth: 0,
        more: 11,
      },
    ]);
  });

  it('returns an empty list when there are no continuation links', () => {
    expect(findContinuationLinks(doc('<main></main>'))).toEqual([]);
  });
});

describe('waitForCommentGrowth', () => {
  const install = (html: string) => {
    const { window } = new JSDOM(html);
    const scope = globalThis as {
      document?: Document;
      MutationObserver?: typeof MutationObserver;
    };
    scope.document = window.document;
    scope.MutationObserver = window.MutationObserver;
    return {
      document: window.document,
      restore: () => {
        delete scope.document;
        delete scope.MutationObserver;
      },
    };
  };

  it('resolves true as soon as a comment is appended', async () => {
    const { document, restore } = install(
      '<div id="comment-tree"><shreddit-comment></shreddit-comment></div>',
    );
    const pending = waitForCommentGrowth({ previousCount: 1, timeoutMs: 500 });
    document
      .querySelector('#comment-tree')
      ?.appendChild(document.createElement('shreddit-comment'));

    await expect(pending).resolves.toBe(true);
    restore();
  });

  it('resolves false when nothing grows before the timeout', async () => {
    const { restore } = install(
      '<div id="comment-tree"><shreddit-comment></shreddit-comment></div>',
    );

    await expect(
      waitForCommentGrowth({ previousCount: 1, timeoutMs: 60 }),
    ).resolves.toBe(false);
    restore();
  });
});

describe('waitForCommentGrowthCount', () => {
  const install = (html: string) => {
    const { window } = new JSDOM(html);
    const scope = globalThis as {
      document?: Document;
      MutationObserver?: typeof MutationObserver;
    };
    scope.document = window.document;
    scope.MutationObserver = window.MutationObserver;
    return {
      document: window.document,
      restore: () => {
        delete scope.document;
        delete scope.MutationObserver;
      },
    };
  };

  it('returns the grown count, avoiding a second count RPC', async () => {
    const { document, restore } = install(
      '<div id="comment-tree"><shreddit-comment></shreddit-comment></div>',
    );
    const pending = waitForCommentGrowthCount({
      previousCount: 1,
      timeoutMs: 500,
    });
    document
      .querySelector('#comment-tree')
      ?.appendChild(document.createElement('shreddit-comment'));

    await expect(pending).resolves.toEqual({ count: 2, grew: true });
    restore();
  });

  it('returns the current count at the timeout', async () => {
    const { restore } = install(
      '<div id="comment-tree"><shreddit-comment></shreddit-comment></div>',
    );

    await expect(
      waitForCommentGrowthCount({ previousCount: 1, timeoutMs: 40 }),
    ).resolves.toEqual({ count: 1, grew: false });
    restore();
  });
});

describe('waitForStableTree', () => {
  it('resolves with the count once the tree stops changing', async () => {
    const { window } = new JSDOM(
      '<div id="comment-tree"><shreddit-comment></shreddit-comment></div>',
    );
    const scope = globalThis as {
      document?: Document;
      MutationObserver?: typeof MutationObserver;
    };
    scope.document = window.document;
    scope.MutationObserver = window.MutationObserver;

    const startedAt = Date.now();
    const stable = waitForStableTree({ quietMs: 40, maxMs: 500 });
    window.document
      .querySelector('#comment-tree')
      ?.appendChild(window.document.createElement('shreddit-comment'));

    await expect(stable).resolves.toBe(2);
    expect(Date.now() - startedAt).toBeLessThan(500);
    delete scope.document;
    delete scope.MutationObserver;
  });
});

describe('readPostFeed', () => {
  it('returns the feed html, post count and validity', () => {
    const document = doc(
      '<shreddit-feed><shreddit-post id="t3_a"></shreddit-post><shreddit-post id="t3_b"></shreddit-post></shreddit-feed>',
    );

    expect(readPostFeed(document)).toEqual({
      html: '<shreddit-post id="t3_a"></shreddit-post><shreddit-post id="t3_b"></shreddit-post>',
      count: 2,
      valid: true,
      reloadUrl: null,
    });
  });

  it('is invalid without a feed or community header', () => {
    expect(readPostFeed(doc('<main></main>'))).toEqual({
      html: '',
      count: 0,
      valid: false,
      reloadUrl: null,
    });
  });
});

describe('waitForPostGrowth', () => {
  it('resolves true when a post is appended and false on timeout', async () => {
    const { window } = new JSDOM(
      '<shreddit-feed><shreddit-post></shreddit-post></shreddit-feed>',
    );
    const scope = globalThis as {
      document?: Document;
      MutationObserver?: typeof MutationObserver;
    };
    scope.document = window.document;
    scope.MutationObserver = window.MutationObserver;

    const pending = waitForPostGrowth({ previousCount: 1, timeoutMs: 500 });
    window.document
      .querySelector('shreddit-feed')
      ?.appendChild(window.document.createElement('shreddit-post'));
    await expect(pending).resolves.toBe(true);

    await expect(
      waitForPostGrowth({ previousCount: 2, timeoutMs: 60 }),
    ).resolves.toBe(false);

    delete scope.document;
    delete scope.MutationObserver;
  });
});

describe('readExpectedCommentCount', () => {
  it('reads the advertised count and tolerates a missing post', () => {
    expect(
      readExpectedCommentCount(
        doc('<shreddit-post comment-count="853"></shreddit-post>'),
      ),
    ).toBe(853);
    expect(readExpectedCommentCount(doc('<main></main>'))).toBe(0);
  });
});

describe('isRedditChallengeUrl', () => {
  it('recognizes the challenge interstitial and lets a normal thread through', () => {
    expect(
      isRedditChallengeUrl(
        'https://www.reddit.com/r/x/comments/y/?solution=abc&js_challenge=1&jsc_token=def',
      ),
    ).toBe(true);
    expect(isRedditChallengeUrl('https://www.reddit.com/r/x/comments/y/')).toBe(
      false,
    );
  });
});

describe('isForbiddenPage', () => {
  it('detects the forbidden marker', () => {
    expect(isForbiddenPage(doc('<div id="shreddit-forbidden"></div>'))).toBe(
      true,
    );
    expect(isForbiddenPage(doc('<main></main>'))).toBe(false);
  });
});
