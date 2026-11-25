// Headful demo of one thread scrape at production speed.
// Brings Chrome to the front, prints a line per expansion batch, then closes
// the window as soon as the result is in.
//   node scripts/headful-demo.mjs askreddit 1xuw9sz
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { collectComments } from '../dist/comment-collection.js';
import {
  clickMoreRepliesBatch,
  findContinuationLinks,
  readCommentCount,
  readCommentTree,
  waitForCommentGrowth,
  waitForStableTree,
} from '../dist/dom.js';
import { ensureFreshBuild } from './preflight.mjs';

ensureFreshBuild();
chromium.use(StealthPlugin());

const [subreddit, postId] = process.argv.slice(2);
if (!subreddit || !postId) {
  console.error('usage: node scripts/headful-demo.mjs <subreddit> <postId>');
  process.exit(2);
}

const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}/`;
const profileDir = '/tmp/reddit-headful-profile';
const startedAt = Date.now();

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  channel: 'chrome',
  viewport: null,
  locale: 'en-US',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
  args: ['--start-maximized'],
});
const page = context.pages()[0] ?? (await context.newPage());
await page.bringToFront();
try {
  execFileSync('osascript', [
    '-e',
    'tell application "Google Chrome" to activate',
  ]);
} catch {
  // activating is best-effort; the window is still open
}

console.log(`opening ${url}`);
await page.goto(url, { waitUntil: 'commit', timeout: 30000 });
await page.waitForSelector('body', { state: 'attached', timeout: 10_000 });
await page.evaluate(() => window.scrollTo(0, 800));
await page.waitForSelector('shreddit-comment', {
  state: 'attached',
  timeout: 15_000,
});
await page.evaluate(waitForStableTree, { quietMs: 250, maxMs: 3_000 });
console.log(`page rendered in ${Date.now() - startedAt} ms — expanding`);

let batches = 0;
const reader = {
  readTree: () => page.evaluate(readCommentTree),
  readCount: () => page.evaluate(readCommentCount),
  clickMoreBatch: async (maxClicks) => {
    const clickStartedAt = Date.now();
    const clicked = await page.evaluate(clickMoreRepliesBatch, { maxClicks });
    if (clicked > 0) {
      batches += 1;
      console.log(
        `  batch ${batches}: clicked ${clicked}, ${Date.now() - clickStartedAt} ms`,
      );
    }
    return clicked;
  },
  waitForGrowth: (previousCount, timeoutMs) =>
    page
      .evaluate(waitForCommentGrowth, { previousCount, timeoutMs })
      .catch(() => false),
};

const result = await collectComments(reader, {
  postId,
  budgetMs: 60_000,
  minInlineForContinuations: 200,
  continuationsOnlyBelowChainDepth: 5,
});

function pageDeepest(comments, rootId) {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  let best = { id: null, depth: -1 };
  for (const comment of comments) {
    let depth = 0;
    let cursor = comment;
    while (cursor && cursor.parent_id !== rootId && byId.has(cursor.parent_id)) {
      cursor = byId.get(cursor.parent_id);
      depth += 1;
    }
    if (depth > best.depth) best = { id: comment.id, depth };
  }
  return best;
}

let hop = 0;
let continuationComments = 0;
let current = result.comments;
let currentRoot = postId;
let chainDepth = 0;
for (;;) {
  const deepest = pageDeepest(current, postId);
  chainDepth = Math.max(chainDepth, deepest.depth);
  const links = await page.evaluate(findContinuationLinks).catch(() => []);
  const next = links.find(
    (link) => link.ownerId.replace(/^t1_/, '') === deepest.id,
  );
  if (!next || hop >= 8) {
    console.log(`chain ends after ${hop} continuation page(s), depth ${chainDepth}`);
    break;
  }
  hop += 1;
  console.log(`  continuation ${hop}: opening ${next.href.slice(0, 70)}`);
  await page.goto(`https://www.reddit.com${next.href}`, {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  });
  await page.waitForSelector('shreddit-comment', {
    state: 'attached',
    timeout: 15000,
  });
  const part = await collectComments(
    {
      readTree: () => page.evaluate(readCommentTree),
      readCount: () => page.evaluate(readCommentCount),
      clickMoreBatch: async (maxClicks) => {
        const clicked = await page.evaluate(clickMoreRepliesBatch, {
          maxClicks,
        });
        return clicked;
      },
      waitForGrowth: (previousCount, timeoutMs) =>
        page
          .evaluate(waitForCommentGrowth, { previousCount, timeoutMs })
          .catch(() => false),
    },
    { postId, budgetMs: 15_000 },
  );
  continuationComments += part.comments.length;
  current = part.comments;
  const partDepth = pageDeepest(current, postId).depth;
  chainDepth = Math.max(chainDepth, chainDepth + 1 + partDepth);
  console.log(
    `  continuation ${hop}: ${part.comments.length} comments, page depth ${partDepth}, running depth ${chainDepth}`,
  );
}

console.log(
  JSON.stringify(
    {
      comments: result.comments.length,
      continuationComments,
      chainDepth,
      renderedAtStart: result.renderedCount,
      expanded: result.expandedCount,
      elapsedMs: Date.now() - startedAt,
      first: result.comments[0]?.body.slice(0, 120),
    },
    null,
    2,
  ),
);
await context.close();
