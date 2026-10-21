/**
 * What a break, or the filler the watchdog writes, is made of. A pure decision: the
 * type of the segment behind it and the reason for it, in, and a list of things to
 * draw, out.
 *
 * The announcement is information, so it is only played when it is new. A break
 * that follows a break was just announced, and a station that has never aired
 * anything has nothing to come back from - both stay silent.
 *
 * No jingle here: a break does not know whether another filler follows it, and the
 * jingle belongs to the moment the show comes back. That is the talk block's job.
 */
export type BreakShapeItem = 'break_liner' | 'music';

export type BreakKind = 'break' | 'filler';

const BREAK_SONGS = 1;
const FILLER_SONGS = 2;

export function breakShape(
  previousType: 'talk' | 'music' | 'jingle' | 'break_liner' | null,
  kind: BreakKind,
): BreakShapeItem[] {
  if (kind === 'break') {
    return ['break_liner', ...songs(BREAK_SONGS)];
  }
  const interrupts = previousType === 'talk' || previousType === 'jingle';
  return [
    ...(interrupts ? (['break_liner'] as const) : []),
    ...songs(FILLER_SONGS),
  ];
}

function songs(count: number): BreakShapeItem[] {
  return Array.from({ length: count }, () => 'music' as const);
}
