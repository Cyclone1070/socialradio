/**
 * How a library file is named in the bucket.
 *
 * A key is the row's identity, so it carries a fingerprint of what the file
 * holds: replacing a song produces a new key instead of overwriting the old one,
 * which is what stops a cache or a CDN from serving audio that is no longer
 * there. Liners are named after their words instead, because the words are the
 * thing being spoken - edit the line and it is a different line.
 */
import { createHash } from 'crypto';

export type Shelf = 'music' | 'jingle';

const FINGERPRINT_LENGTH = 6;

export function slug(text: string, max = 48): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned.slice(0, max).replace(/-$/, '');
}

export function contentKey(
  shelf: Shelf,
  name: string,
  content: Buffer | string,
): string {
  const fingerprint = createHash('sha256')
    .update(content)
    .digest('hex')
    .slice(0, FINGERPRINT_LENGTH);
  return `${shelf}/${slug(name)}-${fingerprint}.mp3`;
}

export function linerKey(text: string): string {
  return `liners/${slug(text)}.mp3`;
}
