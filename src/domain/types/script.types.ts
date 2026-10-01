export interface ScriptTurn {
  speaker: string;
  text: string;
}

export interface ScriptData {
  postId: string;
  turns: ScriptTurn[];
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
}

export type ScriptOutcome = ScriptData | ScriptRejection | string;
