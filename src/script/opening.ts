/**
 * What a conversation can be asked to do about what came before it. Computed from
 * what actually aired, never decided by the model.
 */
export type ContinuityKind =
  'open-the-show' | 'welcome-back' | 'pick-up-the-thread';

/** Openers that say "we have just come back", which is a claim about the past. */
const WELCOME_BACK =
  /\b(welcome back|we(?:'| a)?re back|back after the break)\b/i;
/** Openers that greet an audience arriving, which is a claim about a beginning. */
const GREETING = /\b(welcome to the show|hello and welcome|welcome in)\b/i;

/**
 * The opening line is the one place continuity is visible, so it is the one place
 * worth checking. The check is deliberately narrow: it refuses a contradiction
 * ("we're back" when nobody went anywhere) and never demands a particular phrase.
 */
export function describeOpeningProblem(
  kind: ContinuityKind | undefined,
  opening: string,
): string | null {
  const line = opening.trim();
  if (!kind || line.length === 0) return null;

  if (kind === 'pick-up-the-thread' && WELCOME_BACK.test(line)) {
    return `the conversation was told to pick up the thread of the last one, and it opens by welcoming listeners back: "${line}"`;
  }

  if (kind === 'open-the-show' && WELCOME_BACK.test(line)) {
    return `this is the first conversation of the show, and it opens by welcoming listeners back: "${line}"`;
  }

  if (
    kind === 'welcome-back' &&
    GREETING.test(line) &&
    !WELCOME_BACK.test(line)
  ) {
    return `listeners have just heard a break, and the conversation opens as if the show were starting: "${line}"`;
  }

  return null;
}
