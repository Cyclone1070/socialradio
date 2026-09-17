import { Channel } from './channel.entity';
import { ScriptTurn } from '../../domain/types/script.types';

export abstract class Segment {
  private _id!: string;
  private _channelId!: string;
  private _channel?: Channel;
  private _playOrder!: number;
  private _audioUrl!: string;
  private _durationSeconds!: number;
  private _createdAt!: Date;
  abstract readonly type: 'music' | 'talk' | 'ad' | 'jingle';

  constructor(createdAt?: Date, id?: string) {
    if (createdAt !== undefined) {
      this._createdAt = createdAt;
    }
    if (id !== undefined) {
      this._id = id;
    }
  }

  get id(): string {
    return this._id;
  }

  private set id(value: string) {
    this._id = value;
  }

  get channelId(): string {
    return this._channelId;
  }

  private set channelId(value: string) {
    this._channelId = value;
  }

  get channel(): Channel | undefined {
    return this._channel;
  }

  private set channel(value: Channel | undefined) {
    this._channel = value;
  }

  get playOrder(): number {
    return this._playOrder;
  }

  set playOrder(value: number) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error('playOrder must be an integer >= 1');
    }
    this._playOrder = value;
  }

  get audioUrl(): string {
    return this._audioUrl;
  }

  set audioUrl(value: string) {
    this._audioUrl = value ?? '';
  }

  get durationSeconds(): number {
    return this._durationSeconds;
  }

  set durationSeconds(value: number) {
    if (
      typeof value !== 'number' ||
      isNaN(value) ||
      value <= 0 ||
      value > 7200
    ) {
      throw new Error('durationSeconds must be > 0 and <= 7200');
    }
    this._durationSeconds = value;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  private set createdAt(value: Date) {
    this._createdAt = value;
  }
}

export class MusicSegment extends Segment {
  readonly type = 'music' as const;
  private _title!: string;
  private _artist!: string;

  constructor(title?: string, artist?: string, createdAt?: Date, id?: string) {
    super(createdAt, id);
    if (title !== undefined) {
      const trimmed = title?.trim();
      if (!trimmed) {
        throw new Error('title cannot be empty');
      }
      this._title = trimmed;
    }
    if (artist !== undefined) {
      const trimmed = artist?.trim();
      if (!trimmed) {
        throw new Error('artist cannot be empty');
      }
      this._artist = trimmed;
    }
  }

  get title(): string {
    return this._title;
  }

  private set title(value: string) {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new Error('title cannot be empty');
    }
    this._title = trimmed;
  }

  get artist(): string {
    return this._artist;
  }

  private set artist(value: string) {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new Error('artist cannot be empty');
    }
    this._artist = trimmed;
  }
}

export class TalkSegment extends Segment {
  readonly type = 'talk' as const;
  private _clusterId!: string;
  private _status: 'generating' | 'ready' | 'failed' = 'generating';
  private _script: ScriptTurn[] | null = null;

  constructor(
    clusterId?: string,
    status?: 'generating' | 'ready' | 'failed',
    createdAt?: Date,
    id?: string,
  ) {
    super(createdAt, id);
    if (clusterId !== undefined) {
      const trimmed = clusterId?.trim();
      if (!trimmed) {
        throw new Error('clusterId cannot be empty');
      }
      this._clusterId = trimmed;
    }
    if (status !== undefined) {
      this.status = status;
    }
  }

  get clusterId(): string {
    return this._clusterId;
  }

  private set clusterId(value: string) {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new Error('clusterId cannot be empty');
    }
    this._clusterId = trimmed;
  }

  get status(): 'generating' | 'ready' | 'failed' {
    return this._status;
  }

  set status(value: 'generating' | 'ready' | 'failed') {
    if (value !== 'generating' && value !== 'ready' && value !== 'failed') {
      throw new Error('Invalid segment status');
    }
    this._status = value;
  }

  get script(): ScriptTurn[] | null {
    return this._script;
  }

  set script(value: ScriptTurn[] | null) {
    this._script = value;
  }
}

export class AdSegment extends Segment {
  readonly type = 'ad' as const;
}

export class JingleSegment extends Segment {
  readonly type = 'jingle' as const;
}
