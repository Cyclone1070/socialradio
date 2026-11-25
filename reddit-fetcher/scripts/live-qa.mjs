// Live QA probe for the comment extractor. Requires a built dist and a
// browserless instance:
//   npm run build
//   BROWSERLESS_WS_URL=ws://localhost:4000/playwright?timeout=300000 \
//     node scripts/live-qa.mjs askreddit 1xuw9sz
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { collectComments } from '../dist/comment-collection.js';
import {
  clickMoreRepliesBatch,
  readCommentCount,
  findContinuationLinks,
  readCommentTree,
  waitForCommentGrowth,
  waitForStableTree,
} from '../dist/dom.js';
import { ensureFreshBuild } from './preflight.mjs';

ensureFreshBuild();


chromium.use(StealthPlugin());

const [subreddit, postId] = process.argv.slice(2).filter((a) => a !== '--manual');
const manual = process.argv.includes('--manual');
if (!subreddit || !postId) {
  console.error('usage: node scripts/live-qa.mjs <subreddit> <postId>');
  process.exit(2);
}

const ws = process.env.BROWSERLESS_WS_URL ?? 'ws://localhost:4000/playwright';
const browser = await chromium.connect(ws);
const context = await browser.newContext({
  locale: 'en-US',
  viewport: { width: 1280, height: 900 },
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
});

const jsonRequests = [];
const rateLimited = [];
const watchRequests = (target) => {
  target.on('request', (request) => {
    if (/\.json(\?|$)/.test(request.url())) jsonRequests.push(request.url());
  });
  target.on('response', (response) => {
    if (response.status() === 429) rateLimited.push(response.url());
  });
};

const page = await context.newPage();
watchRequests(page);

const startedAt = Date.now();
await page.goto(`https://www.reddit.com/r/${subreddit}/comments/${postId}/`, {
  waitUntil: 'domcontentloaded',
  timeout: 45000,
});
await page.evaluate(() => window.scrollTo(0, 800)).catch(() => {});
await page.waitForSelector('shreddit-comment', { timeout: 20000 }).catch(() => {});
await page
  .evaluate(waitForStableTree, { quietMs: 250, maxMs: 3000 })
  .catch(() => {});

const urlBefore = page.url();
const growthReader = (target) => ({
  readTree: () => target.evaluate(readCommentTree),
  readCount: () => target.evaluate(readCommentCount),
  clickMoreBatch: (maxClicks) =>
    target.evaluate(clickMoreRepliesBatch, { maxClicks }),
  waitForGrowth: (previousCount, timeoutMs) =>
    target
      .evaluate(waitForCommentGrowth, { previousCount, timeoutMs })
      .catch(() => false),
});
const reader = growthReader(page);

const deadline = startedAt + 90_000;
const collectContinuations = async () => {
  const links = await page.evaluate(findContinuationLinks);
  const merged = [];
  for (const link of links.slice(0, 8)) {
    if (Date.now() > deadline - 3_000) break;
    const continuation = await context.newPage();
    watchRequests(continuation);
    try {
      await continuation.goto(`https://www.reddit.com${link.href}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await continuation
        .waitForSelector('shreddit-comment', { timeout: 10_000 })
        .catch(() => {});
      const sub = await collectComments(
        growthReader(continuation),
        {
          postId,
          cap: 200,
          budgetMs: Math.max(3_000, deadline - Date.now() - 3_000),
        },
      );
      const ownerId = link.ownerId.replace(/^t1_/, '');
      merged.push(...sub.comments.filter((comment) => comment.id !== ownerId));
    } catch {
      // a failed continuation never fails the extraction
    } finally {
      await continuation.close().catch(() => {});
    }
  }
  return merged;
};

let result;
try {
  result = await collectComments(reader, {
    postId,
    budgetMs: Math.max(5_000, Math.min(60_000, deadline - Date.now() - 10_000)),
    minInlineForContinuations: 200,
    continuationsOnlyBelowChainDepth: 5,
    collectContinuations,
  });
} catch (error) {
  console.log(
    JSON.stringify(
      {
        thread: `${subreddit}/${postId}`,
        error: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - startedAt,
        rateLimited: rateLimited.length,
        url: page.url(),
      },
      null,
      2,
    ),
  );
  await browser.close().catch(() => {});
  process.exit(1);
}

const elapsedMs = Date.now() - startedAt;
const urlSame = page.url() === urlBefore;
const comments = result.comments;
const words = comments.reduce(
  (sum, comment) => sum + comment.body.trim().split(/\s+/).filter(Boolean).length,
  0,
);
const invalidFields = comments.filter(
  (c) =>
    !c.id ||
    !c.body ||
    !c.author ||
    !Number.isInteger(c.score) ||
    !Number.isInteger(c.created_utc) ||
    c.created_utc <= 0 ||
    !c.parent_id,
).length;
const byId = new Map(comments.map((comment) => [comment.id, comment]));
const chainLength = (comment) => {
  let length = 1;
  let current = comment;
  let guard = 0;
  while (
    current &&
    current.parent_id !== postId &&
    byId.has(current.parent_id) &&
    guard++ < 50
  ) {
    length += 1;
    current = byId.get(current.parent_id);
  }
  return length;
};
const ids = new Set(comments.map((comment) => comment.id));

let manualFailed = false;
if (manual) {
  const observed = new Set();
  const grab = async (target) => {
    const records = await target.evaluate(() =>
      [...document.querySelectorAll('shreddit-comment')]
        .map((comment) => ({
          id: comment.getAttribute('thingid'),
          body: (comment.querySelector('[slot=comment]')?.textContent || '').trim(),
        }))
        .filter((record) => record.id && record.body),
    );
    records.forEach((record) => observed.add(record.id.replace(/^t1_/, '')));
  };
  for (let i = 0; i < 300; i += 1) {
    const before = await page.evaluate(readCommentTree);
    const clicked = await page.evaluate(clickMoreRepliesBatch, {
      maxClicks: 16,
    });
    if (!clicked) break;
    await page.evaluate(waitForCommentGrowth, {
      previousCount: before.count,
      timeoutMs: 1500,
    });
  }
  await grab(page);
  const inlineObserved = new Set(observed);
  const links = await page.evaluate(findContinuationLinks);
  for (const link of links.slice(0, 20)) {
    const continuation = await context.newPage();
    watchRequests(continuation);
    try {
      await continuation.goto(`https://www.reddit.com${link.href}`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await continuation
        .evaluate(waitForStableTree, { quietMs: 250, maxMs: 3000 })
        .catch(() => {});
      for (let i = 0; i < 40; i += 1) {
        const before = await continuation.evaluate(readCommentTree);
        const clicked = await continuation.evaluate(clickMoreRepliesBatch, {
          maxClicks: 16,
        });
        if (!clicked) break;
        await continuation.evaluate(waitForCommentGrowth, {
          previousCount: before.count,
          timeoutMs: 1500,
        });
      }
      await grab(continuation);
    } catch {
      // ignore a failed manual continuation
    } finally {
      await continuation.close().catch(() => {});
    }
  }
  const returnedIds = new Set(result.comments.map((comment) => comment.id));
  const missing = [...observed].filter((id) => !returnedIds.has(id));
  const missingInline = [...inlineObserved].filter((id) => !returnedIds.has(id));
  const extra = [...returnedIds].filter((id) => !observed.has(id));
  if (missingInline.length > 0 || extra.length > 0) manualFailed = true;
  console.log(
    JSON.stringify({
      manual: {
        observed: observed.size,
        inlineObserved: inlineObserved.size,
        returned: returnedIds.size,
        missing: missing.length,
        missingInline: missingInline.length,
        extra: extra.length,
      },
    }),
  );
}

const brokenParents = comments.filter(
  (c) => c.parent_id !== postId && !ids.has(c.parent_id),
).length;
const unique = ids.size === comments.length;
const minComments = Number(process.env.LIVE_QA_MIN_COMMENTS ?? 0);
const minWords = Number(process.env.LIVE_QA_MIN_WORDS ?? 0);
const maxMs = Number(process.env.LIVE_QA_MAX_MS ?? 0);
const tooSlow = Number.isFinite(maxMs) && maxMs > 0 && elapsedMs > maxMs;
const tooFewComments =
  Number.isFinite(minComments) && minComments > 0 && comments.length < minComments;
const tooFewWords =
  Number.isFinite(minWords) && minWords > 0 && words < minWords;
const failed =
  manualFailed ||
  invalidFields > 0 ||
  brokenParents > 0 ||
  !unique ||
  rateLimited.length > 0 ||
  tooSlow ||
  tooFewComments ||
  tooFewWords;

console.log(
  JSON.stringify(
    {
      thread: `${subreddit}/${postId}`,
      returned: comments.length,
      words,
      rendered: result.renderedCount,
      expanded: result.expandedCount,
      elapsedMs,
      gates: { minComments, minWords, maxMs },
      urlSame,
      jsonRequests: jsonRequests.length,
      rateLimited: rateLimited.length,
      unique,
      maxParentChain: Math.max(0, ...comments.map(chainLength)),
      invalidFields,
      brokenParents,
      sortedDesc: comments.every(
        (c, i) => i === 0 || comments[i - 1].score >= c.score,
      ),
      top3: comments
        .slice(0, 3)
        .map((c) => ({ id: c.id, score: c.score, body: c.body.slice(0, 60) })),
      failed,
    },
    null,
    2,
  ),
);

await browser.close();
process.exit(failed ? 1 : 0);
