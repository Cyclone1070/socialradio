export class MusicTrack {
  private _id!: string;
  private _title!: string;
  private _artist!: string;
  private _filePath!: string;
  private _durationSeconds!: number;
  private _createdAt!: Date;

  constructor(
    title?: string,
    artist?: string,
    filePath?: string,
    durationSeconds?: number,
    id?: string,
    createdAt?: Date,
  ) {
    if (title !== undefined) this.title = title;
    if (artist !== undefined) this.artist = artist;
    if (filePath !== undefined) {
      const trimmed = filePath?.trim();
      if (!trimmed) {
        throw new Error('filePath cannot be empty');
      }
      this._filePath = trimmed;
    }
    if (durationSeconds !== undefined) {
      if (
        typeof durationSeconds !== 'number' ||
        isNaN(durationSeconds) ||
        durationSeconds <= 0
      ) {
        throw new Error('durationSeconds must be > 0');
      }
      this._durationSeconds = durationSeconds;
    }
    if (id !== undefined) this._id = id;
    if (createdAt !== undefined) this._createdAt = createdAt;
  }

  get id(): string {
    return this._id;
  }

  private set id(value: string) {
    this._id = value;
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

  get filePath(): string {
    return this._filePath;
  }

  private set filePath(value: string) {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new Error('filePath cannot be empty');
    }
    this._filePath = trimmed;
  }

  get durationSeconds(): number {
    return this._durationSeconds;
  }

  private set durationSeconds(value: number) {
    if (typeof value !== 'number' || isNaN(value) || value <= 0) {
      throw new Error('durationSeconds must be > 0');
    }
    this._durationSeconds = value;
  }

  get createdAt(): Date {
    return this._createdAt
      ? new Date(this._createdAt.getTime())
      : this._createdAt;
  }

  private set createdAt(value: Date) {
    if (value !== undefined) {
      if (!(value instanceof Date) || isNaN(value.getTime())) {
        throw new Error('createdAt must be a valid Date');
      }
      this._createdAt = new Date(value.getTime());
    }
  }
}
