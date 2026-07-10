export interface BaseAudioRef {
  filePath: string;
  durationSeconds: number;
}

export interface SongRef extends BaseAudioRef {
  title: string;
  artist: string;
}

export interface TalkRef extends BaseAudioRef {
  postIds: string[];
}

export interface AdRef extends BaseAudioRef {
  advertiser: string;
}

export interface JingleRef extends BaseAudioRef {
  name: string;
}
