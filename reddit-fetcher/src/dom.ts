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
  depth: number;
  more: number;
}

/**
 * Reads the rendered comment tree. Runs inside the page and in tests.
 */
export function readCommentTree(doc: Document = document): CommentTreeSnapshot {
  const tree = doc.querySelector('#comment-tree');
  const comments = [...doc.querySelectorAll('shreddit-comment')];
  if (!tree && comments.length === 0) {
    throw new Error('comment tree not rendered');
  }
  const insideTree =
    tree && comments.every((comment) => tree.contains(comment));
  if (insideTree) {
    return { html: tree.innerHTML, count: comments.length };
  }
  // Focused "continue this thread" pages, and some threads that render extra
  // branches outside #comment-tree, need every root serialized.
  const roots = comments.filter(
    (comment) => !comment.parentElement?.closest('shreddit-comment'),
  );
  return {
    html: roots.map((comment) => comment.outerHTML).join(''),
    count: comments.length,
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
    const ownerEl = anchor.closest('shreddit-comment');
    const ownerId = ownerEl?.getAttribute('thingid') || '';
    const depth = Number(ownerEl?.getAttribute('depth') ?? 0) || 0;
    const more =
      Number((anchor.textContent || '').match(/(\d+)\s+more/i)?.[1] ?? 0) || 0;
    if (!href || !ownerId || seen.has(href)) continue;
    seen.add(href);
    links.push({ href, ownerId, depth, more });
  }

  return links;
}

/**
 * Finds continuation anchors a user can actually click. Hidden `.fold-more`
 * twins carry the same hrefs; deduping by href keeps one entry per subtree.
 */
export function findVisibleContinuationLinks(
  doc: Document = document,
): ContinuationLink[] {
  const seen = new Set<string>();
  const links: ContinuationLink[] = [];

  for (const anchor of doc.querySelectorAll('a[href*="force-legacy-sct=1"]')) {
    const href = anchor.getAttribute('href') || '';
    const ownerEl = anchor.closest('shreddit-comment');
    const ownerId = ownerEl?.getAttribute('thingid') || '';
    const depth = Number(ownerEl?.getAttribute('depth') ?? 0) || 0;
    const label = anchor.textContent || '';
    const more = Number(label.match(/(\d+)\s+more/i)?.[1] ?? 0) || 0;
    const visible =
      (anchor as HTMLElement).offsetWidth > 0 ||
      (anchor as HTMLElement).offsetHeight > 0;
    if (
      !href ||
      !ownerId ||
      !visible ||
      seen.has(href) ||
      !/more repl|continue this thread/i.test(label)
    ) {
      continue;
    }
    seen.add(href);
    links.push({ href, ownerId, depth, more });
  }

  return links;
}

/**
 * Removes the logged-out login wall that covers the page and swallows real
 * mouse clicks. DOM clicks on buttons bypass it, but continuation anchors need
 * a real pointer event.
 */
export function dismissLoginModal(doc: Document = document): number {
  let removed = 0;
  for (const el of doc.querySelectorAll('.rpl-dialog, rpl-modal-card')) {
    el.remove();
    removed += 1;
  }
  doc.body?.classList.remove('rpl-scroll-lock');
  return removed;
}

/**
 * Tags the first visible continuation anchor for `href` so Playwright can click
 * it with a real mouse event.
 */
export function markContinuationAnchor(
  arg: { href: string },
  doc: Document = document,
): boolean {
  for (const stale of doc.querySelectorAll('a[data-reddit-link="1"]')) {
    stale.removeAttribute('data-reddit-link');
  }
  for (const anchor of doc.querySelectorAll('a[href*="force-legacy-sct=1"]')) {
    if (anchor.getAttribute('href') !== arg.href) continue;
    const el = anchor as HTMLElement;
    if (el.offsetWidth === 0 && el.offsetHeight === 0) continue;
    el.setAttribute('data-reddit-link', '1');
    return true;
  }
  return false;
}

/** Clicks the anchor tagged by `markContinuationAnchor`. */
export function clickMarkedContinuation(doc: Document = document): boolean {
  const anchor = doc.querySelector('a[data-reddit-link="1"]');
  if (!anchor) return false;
  (anchor as HTMLElement).click();
  return true;
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
 * Like `waitForCommentGrowth`, but returns the observed count so the caller
 * does not need a second `readCommentCount` round-trip.
 */
export async function waitForCommentGrowthCount(arg: {
  previousCount: number;
  timeoutMs: number;
}): Promise<{ count: number; grew: boolean }> {
  const count = () => document.querySelectorAll('shreddit-comment').length;
  const initial = count();
  if (initial > arg.previousCount) {
    return { count: initial, grew: true };
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      const current = count();
      resolve({ count: current, grew: current > arg.previousCount });
    };
    const observer = new MutationObserver(() => {
      if (count() > arg.previousCount) finish();
    });
    const timer = setTimeout(finish, arg.timeoutMs);
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
 * Clicks up to `maxClicks` "more replies" buttons in one pass. Each button is
 * tagged with the label it was clicked at: Reddit reuses the same element for
 * the next batch and only changes its text, so identity alone would strand the
 * remaining replies.
 */
export function clickMoreRepliesBatch(
  arg: { maxClicks?: number; force?: boolean } = {},
  doc: Document = document,
): number {
  const maxClicks = arg.maxClicks ?? 8;
  // Keep clicking a control while it is still present. Reddit can leave a
  // control with the same label after loading only part of its reply batch;
  // remembering the label and skipping it loses those replies.
  const pending = [...doc.querySelectorAll('button')].filter((candidate) =>
    /more\s+repl|more\s+comment/i.test((candidate.textContent || '').trim()),
  );
  const batch = pending.slice(0, maxClicks);
  for (const button of batch) {
    button.dataset.qaClickedAt = (button.textContent || '').trim();
    // Scrolling is not just visibility: it also wakes Reddit's lazy subtree
    // renderer. A visible control can still be inert until scrolled.
    button.scrollIntoView?.({ block: 'center' });
    button.click();
  }
  return batch.length;
}

export interface PostFeedSnapshot {
  html: string;
  count: number;
  valid: boolean;
  reloadUrl: string | null;
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
    reloadUrl: feed?.getAttribute('reload-url') ?? null,
  };
}

/**
 * The rendered page is a teaser (often three posts) for logged-out readers.
 * Reddit's own `reload-url` endpoint returns the next server-rendered page.
 * Runs inside the page so the request carries the browser's cookies.
 */
export async function fetchMorePosts(
  url: string,
): Promise<{ ok: boolean; html: string; count: number }> {
  try {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    if (!response.ok) return { ok: false, html: '', count: 0 };
    const text = await response.text();
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const posts = [...doc.querySelectorAll('shreddit-post')];
    return {
      ok: true,
      html: posts.map((post) => post.outerHTML).join(''),
      count: posts.length,
    };
  } catch {
    return { ok: false, html: '', count: 0 };
  }
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
/** Reads the thread's advertised total comment count from the post element. */
export function readExpectedCommentCount(doc: Document = document): number {
  return Number(
    doc.querySelector('shreddit-post')?.getAttribute('comment-count') ?? 0,
  );
}

/** True for Reddit's JS-challenge interstitial URL. */
export function isRedditChallengeUrl(url: string): boolean {
  return /(?:[?&](?:js_challenge=1|solution=)|jsc_token=)/i.test(url);
}

export function isForbiddenPage(doc: Document = document): boolean {
  if (doc.querySelector('#shreddit-forbidden')) return true;
  const password = doc.querySelector('input[type="password"]');
  return Boolean(password && !doc.querySelector('shreddit-comment'));
}
