export interface AudioData {
  filePath: string;
  durationSeconds: number;
}

export interface SongData extends AudioData {
  title: string;
  artist: string;
}

export interface TalkData extends AudioData {
  postIds: string[];
}

export interface AdData extends AudioData {
  advertiser: string;
}

export interface JingleData extends AudioData {
  name: string;
}
