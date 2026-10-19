/**
 * What a break, or the filler the watchdog writes, is made of. A pure decision: the
 * type of the segment behind it and the reason for it, in, and a list of things to
 * draw, out.
 *
 * The announcement is information, so it is only played when it is new. A break
 * that follows a break was just announced, and a station that has never aired
 * anything has nothing to come back from - both stay silent.
 */
export type BreakShapeItem = 'liner' | 'music';

export type BreakKind = 'break' | 'filler';

const BREAK_SONGS = 1;
const FILLER_SONGS = 2;

export function breakShape(
  previousType: 'talk' | 'music' | 'jingle' | 'liner' | null,
  kind: BreakKind,
): BreakShapeItem[] {
  if (kind === 'break') {
    return ['liner', ...songs(BREAK_SONGS)];
  }
  const interrupts = previousType === 'talk' || previousType === 'jingle';
  return [...(interrupts ? (['liner'] as const) : []), ...songs(FILLER_SONGS)];
}

function songs(count: number): BreakShapeItem[] {
  return Array.from({ length: count }, () => 'music' as const);
}
