import type { RedditCommentData } from './types';
import { JSDOM } from 'jsdom';

export interface RawComment {
  thingId: string;
  author: string;
  score: string;
  created: string;
  depth: number;
  parentThingId: string | null;
  body: string;
}

/**
 * Parses the rendered comment tree HTML into raw comment records.
 * Parents are derived from DOM nesting: a comment's parent is the nearest
 * ancestor `shreddit-comment`, or null at the top level.
 */
export function parseCommentTree(html: string): RawComment[] {
  const { document } = new JSDOM(`<div id="root">${html}</div>`).window;
  const nodes = [...document.querySelectorAll('shreddit-comment')];

  return nodes.map((el) => {
    const bodyEl = el.querySelector('[slot="comment"]');
    const parent = el.parentElement?.closest('shreddit-comment') ?? null;

    return {
      thingId: el.getAttribute('thingid') ?? '',
      author: el.getAttribute('author') ?? '',
      score: el.getAttribute('score') ?? '0',
      created: el.getAttribute('created') ?? '',
      depth: Number.parseInt(el.getAttribute('depth') ?? '0', 10) || 0,
      parentThingId: parent?.getAttribute('thingid') ?? null,
      body: readBodyText(bodyEl),
    };
  });
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

/** Joins block-level content with spaces so paragraphs do not run together. */
function textOf(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (node.nodeType !== 1) return '';
  const element = node as Element;
  if (element.tagName === 'BR') return '\n';
  const inner = Array.from(element.childNodes).map(textOf).join('');
  return BLOCK_TAGS.has(element.tagName) ? ` ${inner} ` : inner;
}

function readBodyText(bodyEl: Element | null): string {
  if (!bodyEl) return '';
  return textOf(bodyEl).replace(/\s+/g, ' ').trim();
}

/**
 * Maps a raw parsed comment onto the fetcher's public comment shape.
 */
export function toRedditComment(
  raw: RawComment,
  postId: string,
): RedditCommentData {
  return {
    id: raw.thingId.replace(/^t1_/, ''),
    body: raw.body.replace(/\s+/g, ' ').trim(),
    author: raw.author,
    score: Number.parseInt(raw.score, 10) || 0,
    parent_id: (raw.parentThingId ?? postId).replace(/^t1_|^t3_/, ''),
    created_utc: Math.floor(Date.parse(raw.created) / 1000) || 0,
  };
}

/**
 * Drops empty comments, removes duplicate ids, orders by score desc,
 * created_utc desc, id asc, and applies the cap.
 */
export function finalizeComments(
  comments: RedditCommentData[],
  cap: number,
  postId: string,
): RedditCommentData[] {
  const seen = new Set<string>();
  const unique: RedditCommentData[] = [];

  for (const comment of comments) {
    if (!comment.id || !comment.body) continue;
    if (!comment.author || !(comment.created_utc > 0)) continue;
    if (seen.has(comment.id)) continue;
    seen.add(comment.id);
    unique.push(comment);
  }

  unique.sort(
    (a, b) =>
      b.score - a.score ||
      b.created_utc - a.created_utc ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const capped = unique.slice(0, cap);
  const keptIds = new Set(capped.map((c) => c.id));

  return capped.map((comment) =>
    comment.parent_id === postId || keptIds.has(comment.parent_id)
      ? comment
      : { ...comment, parent_id: postId },
  );
}

/**
 * Longest parent chain in the collected set, counting the comment itself.
 * Top-level comments count as depth 1; an empty set is depth 0.
 */
export function maxChainDepth(
  comments: RedditCommentData[],
  postId: string,
): number {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  let max = 0;

  for (const comment of comments) {
    let depth = 1;
    let current: RedditCommentData | undefined = comment;
    let guard = 0;
    while (
      current &&
      current.parent_id !== postId &&
      byId.has(current.parent_id) &&
      guard++ < 100
    ) {
      depth += 1;
      current = byId.get(current.parent_id);
    }
    max = Math.max(max, depth);
  }

  return max;
}
