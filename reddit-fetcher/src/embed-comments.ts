import { JSDOM } from 'jsdom';
import { finalizeComments } from './comments';
import { withTimeout } from './timeout';
import type { RedditCommentData } from './types';

const RELATIVE_UNITS: Record<string, number> = {
  second: 1,
  sec: 1,
  minute: 60,
  min: 60,
  hour: 3_600,
  hr: 3_600,
  day: 86_400,
  week: 604_800,
  month: 2_592_000,
  mo: 2_592_000,
  year: 31_536_000,
};

function embeddedHtml(value: string): string {
  const match = value.match(/document\.write\(("[\s\S]*")\);\s*$/);
  if (!match) return value;
  try {
    return JSON.parse(match[1]) as string;
  } catch {
    return value;
  }
}

const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'LI',
  'UL',
  'OL',
  'BLOCKQUOTE',
  'PRE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
]);

function textOf(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (node.nodeType !== 1) return '';
  const element = node as Element;
  if (element.tagName === 'BR') return '\n';
  const inner = Array.from(element.childNodes).map(textOf).join('');
  return BLOCK_TAGS.has(element.tagName) ? ` ${inner} ` : inner;
}

function bodyText(element: Element): string {
  return textOf(element)
    .replace(/https?:\/\/(?:preview|i)\.redd\.it\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function relativeSeconds(value: string, now: number): number {
  if (/just now/i.test(value)) return now;
  const match = value.match(
    /(\d+)\s*(second|sec|minute|min|hour|hr|day|week|month|mo|year)s?\.?\s+ago/i,
  );
  if (!match) return 0;
  return now - Number(match[1]) * (RELATIVE_UNITS[match[2].toLowerCase()] ?? 0);
}

function idOf(element: Element | null): string | null {
  if (!element) return null;
  const match = (element.getAttribute('class') ?? '').match(
    /(?:^|\s)id-t1_([a-z0-9]+)(?:\s|$)/i,
  );
  return match?.[1] ?? null;
}

/**
 * Reads the server-rendered Reddit embed view. It is a legacy, flat-ish DOM
 * with nested comment divs and relative timestamps, but it avoids a full
 * browser render and exposes the same public fields.
 */
export function parseEmbeddedComments(
  input: string,
  postId: string,
  now: number,
  cap = 500,
): RedditCommentData[] {
  const html = embeddedHtml(input);
  const document = new JSDOM(`<div id="root">${html}</div>`).window.document;
  const comments: RedditCommentData[] = [];

  for (const element of document.querySelectorAll('div.reddit-link')) {
    const id = idOf(element);
    if (!id) continue;
    const bodyEl = element.querySelector('.md');
    if (!bodyEl) continue;
    const body = bodyText(bodyEl);
    if (!body) continue;

    const author =
      element.querySelector('a[href*="/user/"]')?.textContent?.trim() ?? '';
    const scoreText =
      element.querySelector(`[id="score_t1_${id}"]`)?.textContent?.trim() ?? '';
    const score = /score hidden/i.test(scoreText)
      ? 0
      : Number.parseInt(scoreText.replace(/[^0-9-]/g, ''), 10) || 0;
    const parent =
      idOf(element.parentElement?.closest('div.reddit-link') ?? null) ?? postId;

    comments.push({
      id,
      body,
      author,
      score,
      parent_id: parent,
      created_utc: relativeSeconds(
        element.querySelector('small')?.textContent ?? '',
        now,
      ),
    });
  }

  return finalizeComments(comments, cap, postId);
}

export class EmbedRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'EmbedRequestError';
  }
}

export interface EmbeddedCommentsResult {
  comments: RedditCommentData[];
  remaining: number | null;
}

export async function fetchEmbeddedComments(
  subreddit: string,
  postId: string,
  options: {
    cap?: number;
    now?: number;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<EmbeddedCommentsResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(postId)}/.embed?limit=500`;
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await withTimeout(
      fetchImpl(url, {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en-US,en;q=0.9',
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
      }),
      timeoutMs,
      'reddit embed request',
    );
    const body = await withTimeout(
      response.text(),
      Math.max(1_000, timeoutMs - 500),
      'reddit embed body',
    );
    if (!response.ok) {
      throw new EmbedRequestError(
        `reddit embed HTTP ${String(response.status)}`,
        response.status,
      );
    }
    const rawRemaining = response.headers?.get?.('x-ratelimit-remaining');
    const remaining =
      rawRemaining === null || rawRemaining === undefined
        ? null
        : Number.parseInt(rawRemaining, 10);
    return {
      comments: parseEmbeddedComments(
        body,
        postId,
        options.now ?? Math.floor(Date.now() / 1000),
        options.cap ?? 500,
      ),
      remaining: Number.isFinite(remaining) ? remaining : null,
    };
  } finally {
    clearTimeout(abortTimer);
  }
}
