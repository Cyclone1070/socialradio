/**
 * The three things a conversation can be told about what came before it. The
 * cases are computed here, in code, from what actually aired - never asked of the
 * model, which would happily invent a thread that nobody was holding.
 */
export type Continuity =
  'open-the-show' | 'welcome-back' | 'pick-up-the-thread';

export interface AiredSegment {
  type: string;
  outline: string | null;
}

export function continuityFor(previous: AiredSegment | null): Continuity {
  if (previous === null) return 'open-the-show';
  const outline = previous.outline?.trim();
  if (previous.type === 'talk' && outline) return 'pick-up-the-thread';
  return 'welcome-back';
}

/**
 * Said to the dialogue stage, in the same breath as the outline, so the opening
 * line is written rather than hoped for.
 */
export function buildDirective(
  continuity: Continuity,
  outline: string | null,
): string {
  // The sentence carries its own case, so the thing that is said and the thing that
  // is checked can never disagree about what the conversation was asked to do.
  return `[${continuity}] ${directiveBody(continuity, outline)}`;
}

function directiveBody(continuity: Continuity, outline: string | null): string {
  switch (continuity) {
    case 'open-the-show':
      return 'This is the first conversation of the show: greet the listeners and introduce the topic before you begin.';
    case 'welcome-back':
      return 'The listeners have just heard a break. Welcome them back, and say where the show stands before you begin.';
    case 'pick-up-the-thread':
      return `Pick up where the last conversation left off. Here is the outline it followed:\n\n${outline}\n\nOpen by referring back to it.`;
  }
}
