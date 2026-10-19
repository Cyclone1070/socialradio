/** A pre-recorded station announcement: a break jingle with a human voice on it. */
export class Liner {
  private _id!: string;
  private _text!: string;
  private _filePath!: string;
  private _durationSeconds!: number;
  private _createdAt!: Date;

  constructor(
    text?: string,
    filePath?: string,
    durationSeconds?: number,
    id?: string,
    createdAt?: Date,
  ) {
    if (text !== undefined) this.text = text;
    if (filePath !== undefined) this.filePath = filePath;
    if (durationSeconds !== undefined) this.durationSeconds = durationSeconds;
    if (id !== undefined) this._id = id;
    if (createdAt !== undefined) this._createdAt = createdAt;
  }

  get id(): string {
    return this._id;
  }

  // The mapper writes every column through its accessor, so an id that can only be
  // read makes the row unloadable.
  private set id(value: string) {
    this._id = value;
  }

  get text(): string {
    return this._text;
  }

  private set text(value: string) {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new Error('text cannot be empty');
    }
    this._text = trimmed;
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
