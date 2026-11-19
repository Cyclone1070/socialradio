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

// Edge case: Reddit moves very deep chains onto their own page. Follow any
// "continue this thread" link in a new tab and collect it the same way.
const continuationLinks = await page
  .evaluate(findContinuationLinks)
  .catch(() => []);
let continuationComments = 0;
console.log(`continuation links: ${continuationLinks.length}`);
for (const link of continuationLinks.slice(0, 1)) {
  console.log(`  opening continuation ${link.href.slice(0, 80)}`);
  const tab = await context.newPage();
  try {
    await tab.goto(`https://www.reddit.com${link.href}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await tab.waitForSelector('shreddit-comment', {
      state: 'attached',
      timeout: 15000,
    });
    const tabReader = {
      readTree: () => tab.evaluate(readCommentTree),
      readCount: () => tab.evaluate(readCommentCount),
      clickMoreBatch: async (maxClicks) => {
        const clicked = await tab.evaluate(clickMoreRepliesBatch, {
          maxClicks,
        });
        if (clicked > 0) await tab.waitForTimeout(0);
        return clicked;
      },
      waitForGrowth: (previousCount, timeoutMs) =>
        tab
          .evaluate(waitForCommentGrowth, { previousCount, timeoutMs })
          .catch(() => false),
    };
    const part = await collectComments(tabReader, {
      postId,
      budgetMs: 20_000,
    });
    continuationComments += part.comments.length;
    console.log(`  continuation page: ${part.comments.length} comments`);
  } finally {
    await tab.close().catch(() => {});
  }
}

console.log(
  JSON.stringify(
    {
      comments: result.comments.length,
      continuationComments,
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
