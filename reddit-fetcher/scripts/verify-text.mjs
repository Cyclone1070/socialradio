// Text-level verification: compare the fetcher's output with the text rendered
// in the page for the same comments.
//   REDDIT_FETCHER_URL=http://localhost:3001 \
//     BROWSERLESS_WS_URL=ws://localhost:4000/playwright \
//     node scripts/verify-text.mjs webscraping 1xys320
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { collectComments } from '../dist/comment-collection.js';
import {
  clickMoreRepliesBatch,
  readCommentTree,
  waitForCommentGrowth,
} from '../dist/dom.js';
import { ensureFreshBuild } from './preflight.mjs';

ensureFreshBuild();

chromium.use(StealthPlugin());

const [subreddit, postId] = process.argv.slice(2);
const base = process.env.REDDIT_FETCHER_URL ?? 'http://localhost:3001';
if (!subreddit || !postId) {
  console.error('usage: node scripts/verify-text.mjs <subreddit> <postId>');
  process.exit(2);
}

const response = await fetch(`${base}/comments/${subreddit}/${postId}`);
if (!response.ok) {
  console.error(`fetcher answered ${response.status} for /comments/${subreddit}/${postId}`);
  process.exit(1);
}
const payload = await response.json();
const apiComments = payload.comments ?? [];
if (apiComments.length < 20) {
  console.error(
    `fetcher returned ${apiComments.length} comments; at least 20 are required`,
  );
  process.exit(1);
}

const browser = await chromium.connect(
  process.env.BROWSERLESS_WS_URL ?? 'ws://localhost:4000/playwright',
);
const context = await browser.newContext({
  locale: 'en-US',
  viewport: { width: 1280, height: 900 },
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
});
const page = await context.newPage();
await page.goto(
  `https://www.reddit.com/r/${subreddit}/comments/${postId}/`,
  { waitUntil: 'domcontentloaded', timeout: 45000 },
);
await page.waitForSelector('shreddit-comment', { timeout: 15000 }).catch(() => {});

const reader = {
  readTree: () => page.evaluate(readCommentTree),
  clickMoreBatch: (maxClicks) =>
    page.evaluate(clickMoreRepliesBatch, { maxClicks }),
  waitForGrowth: (previousCount, timeoutMs) =>
    page
      .evaluate(waitForCommentGrowth, { previousCount, timeoutMs })
      .catch(() => false),
};
await collectComments(reader, { postId, budgetMs: 60_000 });

const rendered = await page.evaluate(() =>
  Object.fromEntries(
    [...document.querySelectorAll('shreddit-comment')]
      .map((comment) => [
        (comment.getAttribute('thingid') || '').replace(/^t1_/, ''),
        (comment.querySelector('[slot=comment]')?.innerText || '').trim(),
      ])
      .filter(([id, body]) => id && body),
  ),
);

const normalize = (text) => text.replace(/\s+/g, ' ').trim();
const top = [...apiComments].sort((a, b) => b.score - a.score).slice(0, 20);
const required = Math.min(20, apiComments.length);
const mismatches = [];
for (const comment of top) {
  const pageText = rendered[comment.id];
  if (pageText === undefined) {
    mismatches.push({ id: comment.id, reason: 'missing in page' });
  } else if (normalize(pageText) !== normalize(comment.body)) {
    mismatches.push({
      id: comment.id,
      reason: 'text differs',
      api: comment.body.slice(0, 120),
      page: pageText.slice(0, 120),
    });
  }
}

if (top.length !== required) {
  console.error(`compared ${top.length} comments, expected ${required}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      thread: `${subreddit}/${postId}`,
      apiCount: apiComments.length,
      renderedCount: Object.keys(rendered).length,
      compared: top.length,
      mismatches,
      sample: top.slice(0, 5).map((comment) => ({
        id: comment.id,
        api: normalize(comment.body).slice(0, 100),
        page: normalize(rendered[comment.id] ?? '').slice(0, 100),
      })),
    },
    null,
    2,
  ),
);

await browser.close();
process.exit(mismatches.length === 0 ? 0 : 1);
