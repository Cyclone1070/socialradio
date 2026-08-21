import { Channel } from './channel.entity';
import { ScriptTurn } from '../../domain/types/script.types';

export abstract class Segment {
  id!: string;
  channelId!: string;
  channel?: Channel;
  playOrder!: number;
  audioUrl: string | null = null;
  durationSeconds: number | null = null;
  type!: 'music' | 'talk' | 'ad' | 'jingle';
  createdAt: Date = new Date();
}

export class MusicSegment extends Segment {
  type = 'music' as const;
  title!: string;
  artist!: string;
}

export class TalkSegment extends Segment {
  type = 'talk' as const;
  clusterId!: string;
  status: 'generating' | 'ready' | 'failed' = 'generating';
  script: ScriptTurn[] | null = null;
}

export class AdSegment extends Segment {
  type = 'ad' as const;
}

export class JingleSegment extends Segment {
  type = 'jingle' as const;
}
