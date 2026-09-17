import { Collection } from '@mikro-orm/core';

export interface SubredditRef {
  id: string;
  name: string;
}

export interface PostRef {
  id: string;
}

export class Channel {
  private _id!: string;
  private _name!: string;
  private _visibility: 'public' | 'private' = 'public';
  private _ownerId: string | null = null;
  private _currentSegmentId: string | null = null;
  private _currentPlayOrder: number | null = null;
  private _playheadStartedAt: Date | null = null;
  private _lastActiveAt: Date | null = null;
  private _subreddits = new Collection<SubredditRef>(this);
  private _completedPosts = new Collection<PostRef>(this);
  private _createdAt!: Date;

  constructor(
    name?: string,
    visibility?: 'public' | 'private',
    ownerId?: string | null,
    id?: string,
    createdAt?: Date,
  ) {
    if (name !== undefined) {
      this.name = name;
    }
    if (visibility !== undefined) {
      this.visibility = visibility;
    }
    if (ownerId !== undefined) {
      this.ownerId = ownerId;
    }
    if (id !== undefined) {
      this._id = id;
    }
    if (createdAt !== undefined) {
      this._createdAt = createdAt;
    }
  }

  get id(): string {
    return this._id;
  }

  private set id(value: string) {
    this._id = value;
  }

  get name(): string {
    return this._name;
  }

  set name(value: string) {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new Error('Channel name cannot be empty');
    }
    this._name = trimmed;
  }

  get visibility(): 'public' | 'private' {
    return this._visibility;
  }

  set visibility(value: 'public' | 'private') {
    if (value !== 'public' && value !== 'private') {
      throw new Error('Invalid visibility');
    }
    this._visibility = value;
  }

  get ownerId(): string | null {
    return this._ownerId;
  }

  set ownerId(value: string | null) {
    this._ownerId = value;
  }

  get currentSegmentId(): string | null {
    return this._currentSegmentId;
  }

  set currentSegmentId(value: string | null) {
    this._currentSegmentId = value;
  }

  get currentPlayOrder(): number | null {
    return this._currentPlayOrder;
  }

  set currentPlayOrder(value: number | null) {
    if (value !== null) {
      if (!Number.isInteger(value) || value < 1) {
        throw new Error('currentPlayOrder must be an integer >= 1');
      }
    }
    this._currentPlayOrder = value;
  }

  get playheadStartedAt(): Date | null {
    return this._playheadStartedAt;
  }

  set playheadStartedAt(value: Date | null) {
    this._playheadStartedAt = value;
  }

  get lastActiveAt(): Date | null {
    return this._lastActiveAt;
  }

  set lastActiveAt(value: Date | null) {
    this._lastActiveAt = value;
  }

  get subreddits(): Collection<SubredditRef> {
    return this._subreddits;
  }

  private set subreddits(value: Collection<SubredditRef>) {
    this._subreddits = value;
  }

  get completedPosts(): Collection<PostRef> {
    return this._completedPosts;
  }

  private set completedPosts(value: Collection<PostRef>) {
    this._completedPosts = value;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  private set createdAt(value: Date) {
    this._createdAt = value;
  }
}
