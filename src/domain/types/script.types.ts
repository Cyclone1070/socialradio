export interface ScriptTurn {
  speaker: string;
  text: string;
}

export interface ScriptData {
  postId: string;
  turns: ScriptTurn[];
  /** The Stage 1 outline the dialogue was written from: the next conversation's segue. */
  outline?: string;
}

/**
 * The model would not turn this content into a usable script. Not an outage:
 * another topic is unaffected, so the caller retires this content and moves on
 * instead of retrying it or treating the whole station as broken.
 */
export interface ScriptRejection {
  rejected: true;
  /** What was wrong with the answer, in the model's own terms. */
  reason: string;
  /** The post the refused script belonged to. */
  postId: string;
  /** Nothing usable came out of it, so there are no turns to air. */
  turns: ScriptTurn[];
  /** Stage 1 can have produced an outline before Stage 2 was refused. */
  outline?: string;
}

export type ScriptOutcome = ScriptData | ScriptRejection | string;
