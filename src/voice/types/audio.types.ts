/** What this slice hands back: the stored audio and the length it measured. */
export interface TalkData {
  filePath: string;
  durationSeconds: number;
  postIds: string[];
}
