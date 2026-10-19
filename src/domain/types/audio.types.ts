export interface MusicData {
  filePath: string;
  durationSeconds: number;
  title: string;
  artist: string;
}

export interface TalkData {
  filePath: string;
  durationSeconds: number;
  postIds: string[];
}

export interface LinerData {
  filePath: string;
  durationSeconds: number;
  text: string;
}

export interface JingleData {
  filePath: string;
  durationSeconds: number;
  name: string;
}
