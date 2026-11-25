// Live regression harness for the built fetcher HTTP API.
//
//   FETCHER_URL=http://127.0.0.1:3013 node scripts/regression.mjs --record
//   FETCHER_URL=http://127.0.0.1:3013 node scripts/regression.mjs --check
//
// Record writes scripts/regression-baseline.json. Check fails on:
// - any HTTP/429 error
// - missing/invalid/duplicate comments or broken parents
// - fewer than 90% of baseline comments or words
// - slower than 125% of baseline elapsed time
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const posts = JSON.parse(readFileSync(join(here, 'regression-posts.json'), 'utf8'));
const baselinePath = join(here, 'regression-baseline.json');
const baseUrl = process.env.FETCHER_URL ?? 'http://127.0.0.1:3013';
const check = process.argv.includes('--check');
const timeoutMs = Number(process.env.REGRESSION_TIMEOUT_MS ?? 180_000);
const commentsFloor = Number(process.env.REGRESSION_COMMENT_FLOOR ?? 0.9);
const wordsFloor = Number(process.env.REGRESSION_WORD_FLOOR ?? 0.9);
const timeCeiling = Number(process.env.REGRESSION_TIME_CEILING ?? 2.5);
const absoluteMaxMs = Number(process.env.REGRESSION_ABSOLUTE_MAX_MS ?? 90_000);

const words = (body) => (body ?? '').trim().split(/\s+/).filter(Boolean).length;
const measurements = [];

const getJson = async (path) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      body: text,
    };
  } catch (error) {
    return {
      status: 0,
      elapsedMs: Date.now() - startedAt,
      body: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};

for (const { subreddit, postId } of posts) {
  const response = await getJson(`/comments/${subreddit}/${postId}`);
  if (response.status !== 200) {
    measurements.push({
      subreddit,
      postId,
      status: response.status,
      elapsedMs: response.elapsedMs,
      error: response.body.slice(0, 300),
    });
    continue;
  }
  let payload;
  try {
    payload = JSON.parse(response.body);
  } catch {
    measurements.push({
      subreddit,
      postId,
      status: response.status,
      elapsedMs: response.elapsedMs,
      error: 'invalid JSON',
    });
    continue;
  }
  const comments = Array.isArray(payload.comments) ? payload.comments : [];
  const ids = comments.map((comment) => comment.id);
  const idSet = new Set(ids);
  measurements.push({
    subreddit,
    postId,
    status: response.status,
    elapsedMs: response.elapsedMs,
    returned: comments.length,
    words: comments.reduce((sum, comment) => sum + words(comment.body), 0),
    invalid: comments.filter(
      (comment) =>
        !comment.id ||
        !comment.body ||
        !comment.author ||
        !Number.isInteger(comment.score) ||
        !Number.isInteger(comment.created_utc) ||
        comment.created_utc <= 0 ||
        !comment.parent_id,
    ).length,
    duplicates: ids.length - idSet.size,
    brokenParents: comments.filter(
      (comment) =>
        comment.parent_id !== postId &&
        !comment.parent_id.startsWith('t3_') &&
        !idSet.has(comment.parent_id),
    ).length,
    commentIds: ids,
  });
}

const failed = measurements.filter(
  (m) => m.status !== 200 || m.invalid || m.duplicates || m.brokenParents,
);

if (!check) {
  writeFileSync(baselinePath, JSON.stringify({ recordedAt: new Date().toISOString(), measurements }, null, 2));
  console.log(JSON.stringify({ mode: 'record', failed: failed.length, measurements }, null, 2));
  process.exit(failed.length > 0 ? 1 : 0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const byKey = new Map(baseline.measurements.map((m) => [`${m.subreddit}/${m.postId}`, m]));
const regressions = [];
for (const current of measurements) {
  const previous = byKey.get(`${current.subreddit}/${current.postId}`);
  if (!previous) {
    regressions.push({ ...current, reason: 'missing baseline' });
    continue;
  }
  if (current.status !== 200) {
    regressions.push({ ...current, reason: 'http/rate-limit failure' });
    continue;
  }
  if (current.invalid || current.duplicates || current.brokenParents) {
    regressions.push({ ...current, reason: 'invalid comments' });
  }
  if (current.returned < Math.floor(previous.returned * commentsFloor)) {
    regressions.push({
      ...current,
      reason: `comments dropped: ${current.returned} < ${Math.floor(previous.returned * commentsFloor)}`,
    });
  }
  if (current.words < Math.floor(previous.words * wordsFloor)) {
    regressions.push({
      ...current,
      reason: `words dropped: ${current.words} < ${Math.floor(previous.words * wordsFloor)}`,
    });
  }
  if (current.elapsedMs > absoluteMaxMs) {
    regressions.push({
      ...current,
      reason: `catastrophically slow: ${current.elapsedMs}ms > ${absoluteMaxMs}ms`,
    });
  } else if (current.elapsedMs > previous.elapsedMs * timeCeiling) {
    regressions.push({
      ...current,
      reason: `slower: ${current.elapsedMs}ms > ${Math.round(previous.elapsedMs * timeCeiling)}ms`,
    });
  }
}

console.log(
  JSON.stringify(
    {
      mode: 'check',
      baselineRecordedAt: baseline.recordedAt,
      failed: failed.length,
      regressions,
      measurements: measurements.map(({ commentIds, ...rest }) => rest),
    },
    null,
    2,
  ),
);
process.exit(failed.length > 0 || regressions.length > 0 ? 1 : 0);
