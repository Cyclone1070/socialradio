/**
 * Page scripts: every function here is serialized into the browser with
 * `page.evaluate`, so the file must stay self-contained — no imports and no
 * references to module scope. ESLint enforces the import ban; unit tests run
 * the same functions under jsdom.
 */
export interface CommentTreeSnapshot {
  html: string;
  count: number;
}

export interface ContinuationLink {
  href: string;
  ownerId: string;
}

/**
 * Reads the rendered comment tree. Runs inside the page and in tests.
 */
export function readCommentTree(doc: Document = document): CommentTreeSnapshot {
  const tree = doc.querySelector('#comment-tree');
  if (!tree) {
    throw new Error('comment tree not rendered');
  }
  return {
    html: tree.innerHTML,
    count: doc.querySelectorAll('shreddit-comment').length,
  };
}

/** Counts rendered comments without serializing the tree. */
export function readCommentCount(doc: Document = document): number {
  return doc.querySelectorAll('shreddit-comment').length;
}

/**
 * Clicks the first inline "more replies" control. Buttons expand in place;
 * anchors navigate to a continuation page and are deliberately ignored.
 */
export function clickMoreReplies(doc: Document = document): boolean {
  const button = [...doc.querySelectorAll('button')].find((candidate) =>
    /more replies/i.test(candidate.textContent || ''),
  );
  if (!button) return false;
  button.scrollIntoView?.({ block: 'center' });
  button.click();
  return true;
}

/**
 * Finds "continue this thread" links and the comment that owns each one.
 * Duplicate hrefs collapse to the first occurrence.
 */
export function findContinuationLinks(
  doc: Document = document,
): ContinuationLink[] {
  const seen = new Set<string>();
  const links: ContinuationLink[] = [];

  for (const anchor of doc.querySelectorAll('a[href*="force-legacy-sct=1"]')) {
    const href = anchor.getAttribute('href') || '';
    const ownerId =
      anchor.closest('shreddit-comment')?.getAttribute('thingid') || '';
    if (!href || !ownerId || seen.has(href)) continue;
    seen.add(href);
    links.push({ href, ownerId });
  }

  return links;
}

/**
 * Resolves true when a `shreddit-comment` appears, using a MutationObserver so
 * there is no polling and no CSP-blocked `eval`. Resolves false on timeout.
 */
export async function waitForCommentGrowth(arg: {
  previousCount: number;
  timeoutMs: number;
}): Promise<boolean> {
  const count = () => document.querySelectorAll('shreddit-comment').length;
  if (count() > arg.previousCount) return true;

  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(value);
    };
    const observer = new MutationObserver(() => {
      if (count() > arg.previousCount) finish(true);
    });
    const timer = setTimeout(() => finish(false), arg.timeoutMs);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  });
}

/**
 * Resolves with the comment count once the tree has been quiet for `quietMs`,
 * or at `maxMs` at the latest. MutationObserver-based, so no fixed sleep.
 */
export async function waitForStableTree(arg: {
  quietMs: number;
  maxMs: number;
}): Promise<number> {
  const count = () => document.querySelectorAll('shreddit-comment').length;
  return new Promise<number>((resolve) => {
    let last = count();
    let lastChange = Date.now();
    const startedAt = Date.now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearInterval(poll);
      resolve(last);
    };
    const observer = new MutationObserver(() => {
      const current = count();
      if (current !== last) {
        last = current;
        lastChange = Date.now();
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    const poll = setInterval(() => {
      if (
        Date.now() - lastChange >= arg.quietMs ||
        Date.now() - startedAt >= arg.maxMs
      ) {
        finish();
      }
    }, 25);
  });
}

/**
 * Clicks up to `maxClicks` unexpanded "more replies" buttons in one pass and
 * marks them so later passes do not re-click a dead control. Clicking a batch
 * removes most of the per-batch network latency that sequential clicking pays.
 */
export function clickMoreRepliesBatch(
  arg: { maxClicks?: number } = {},
  doc: Document = document,
): number {
  const maxClicks = arg.maxClicks ?? 8;
  const buttons = [...doc.querySelectorAll('button')].filter(
    (candidate) =>
      /more replies/i.test(candidate.textContent || '') &&
      candidate.dataset.qaClicked !== '1',
  );
  const batch = buttons.slice(0, maxClicks);
  for (const button of batch) {
    button.dataset.qaClicked = '1';
    button.scrollIntoView?.({ block: 'center' });
    button.click();
  }
  return batch.length;
}

export interface PostFeedSnapshot {
  html: string;
  count: number;
  valid: boolean;
}

/**
 * Reads the rendered subreddit feed. `valid` distinguishes an existing
 * community (feed or header present) from the empty shell Reddit returns for a
 * missing subreddit.
 */
export function readPostFeed(doc: Document = document): PostFeedSnapshot {
  const feed = doc.querySelector('shreddit-feed');
  return {
    html: feed ? feed.innerHTML : '',
    count: doc.querySelectorAll('shreddit-post').length,
    valid: Boolean(feed || doc.querySelector('shreddit-subreddit-header')),
  };
}

/**
 * Resolves true when another `shreddit-post` renders, using a MutationObserver.
 */
export async function waitForPostGrowth(arg: {
  previousCount: number;
  timeoutMs: number;
}): Promise<boolean> {
  const count = () => document.querySelectorAll('shreddit-post').length;
  if (count() > arg.previousCount) return true;

  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(value);
    };
    const observer = new MutationObserver(() => {
      if (count() > arg.previousCount) finish(true);
    });
    const timer = setTimeout(() => finish(false), arg.timeoutMs);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  });
}

/**
 * Scrolls to the bottom of the feed to trigger Reddit's infinite scroll.
 */
export function scrollForMorePosts(): number {
  window.scrollTo(0, document.body.scrollHeight);
  return document.querySelectorAll('shreddit-post').length;
}

/**
 * Reddit renders a forbidden marker or a login wall instead of a thread when it
 * blocks the request.
 */
export function isForbiddenPage(doc: Document = document): boolean {
  if (doc.querySelector('#shreddit-forbidden')) return true;
  const password = doc.querySelector('input[type="password"]');
  return Boolean(password && !doc.querySelector('shreddit-comment'));
}
