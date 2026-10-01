/** What the app sends: the script for one post, speaker by speaker. */
export type Turn = { speaker: string; text: string };
export type Script = { postId: string; turns: Turn[] };

/** What the service answers: the finished audio and how long it really is. */
export type Track = { audio: Buffer; seconds: number };

/** The script had nothing a voice could say. Not an outage: the caller sent it. */
export class NothingToSpeakError extends Error {}
