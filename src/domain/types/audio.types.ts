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

export interface AdData {
  filePath: string;
  durationSeconds: number;
  advertiser: string;
}

export interface JingleData {
  filePath: string;
  durationSeconds: number;
  name: string;
}
