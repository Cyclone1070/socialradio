/**
 * How a library file is named in the bucket.
 *
 * A key is the row's identity, so it carries a fingerprint of what the file
 * holds: replacing a song produces a new key instead of overwriting the old one,
 * which is what stops a cache or a CDN from serving audio that is no longer
 * there. Break liners are named after their words instead, because the words are
 * the thing being spoken - edit the line and it is a different line.
 *
 * A renamed key is not garbage: the manifest lists what should exist, so the key
 * that lost its entry is pruned from the bucket and its row on the next reconcile.
 */
import { createHash } from 'crypto';

/** Where a kind is filed in the bucket. Not the manifest's kind: `jingles/`. */
const SHELF: Record<'music' | 'jingle', string> = {
  music: 'music',
  jingle: 'jingles',
};

const FINGERPRINT_LENGTH = 6;

export function slug(text: string, max = 48): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned.slice(0, max).replace(/-$/, '');
}

export function contentKey(
  kind: 'music' | 'jingle',
  name: string,
  content: Buffer | string,
): string {
  const fingerprint = createHash('sha256')
    .update(content)
    .digest('hex')
    .slice(0, FINGERPRINT_LENGTH);
  return `${SHELF[kind]}/${slug(name)}-${fingerprint}.mp3`;
}

export function breakLinerKey(text: string): string {
  return `break_liners/${slug(text)}.mp3`;
}
