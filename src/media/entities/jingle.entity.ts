export class Jingle {
  private _id!: string;
  private _name!: string;
  private _filePath!: string;
  private _durationSeconds!: number;
  private _createdAt!: Date;

  constructor(
    name?: string,
    filePath?: string,
    durationSeconds?: number,
    id?: string,
    createdAt?: Date,
  ) {
    if (name !== undefined) this.name = name;
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

  get name(): string {
    return this._name;
  }

  private set name(value: string) {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new Error('name cannot be empty');
    }
    this._name = trimmed;
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
