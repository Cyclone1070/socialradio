/** The three kinds of station media this slice hands out. */
export interface MusicData {
  filePath: string;
  durationSeconds: number;
  title: string;
  artist: string;
}

export interface BreakLinerData {
  filePath: string;
  durationSeconds: number;
  text: string;
}

export interface JingleData {
  filePath: string;
  durationSeconds: number;
  name: string;
}
