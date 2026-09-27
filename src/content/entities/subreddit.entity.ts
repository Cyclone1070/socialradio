export class Subreddit {
  private _id!: string;
  private _name!: string;
  private _lastScrapedAt: Date | null = null;
  private _scrapeStartedAt: Date | null = null;
  private _scrapeCooldownUntil: Date | null = null;
  private _createdAt!: Date;

  constructor(name?: string, id?: string, createdAt?: Date) {
    if (name !== undefined) {
      this.name = name;
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
    const trimmed = value?.trim().toLowerCase();
    if (!trimmed) {
      throw new Error('Subreddit name cannot be empty');
    }
    this._name = trimmed;
  }

  get lastScrapedAt(): Date | null {
    return this._lastScrapedAt ? new Date(this._lastScrapedAt.getTime()) : null;
  }

  set lastScrapedAt(value: Date | null) {
    if (value !== null) {
      if (!(value instanceof Date) || isNaN(value.getTime())) {
        throw new Error('lastScrapedAt must be a valid Date or null');
      }
      this._lastScrapedAt = new Date(value.getTime());
    } else {
      this._lastScrapedAt = null;
    }
  }

  get scrapeStartedAt(): Date | null {
    return this._scrapeStartedAt
      ? new Date(this._scrapeStartedAt.getTime())
      : null;
  }

  set scrapeStartedAt(value: Date | null) {
    if (value !== null) {
      if (!(value instanceof Date) || isNaN(value.getTime())) {
        throw new Error('scrapeStartedAt must be a valid Date or null');
      }
      this._scrapeStartedAt = new Date(value.getTime());
    } else {
      this._scrapeStartedAt = null;
    }
  }

  get scrapeCooldownUntil(): Date | null {
    return this._scrapeCooldownUntil
      ? new Date(this._scrapeCooldownUntil.getTime())
      : null;
  }

  set scrapeCooldownUntil(value: Date | null) {
    if (value !== null) {
      if (!(value instanceof Date) || isNaN(value.getTime())) {
        throw new Error('scrapeCooldownUntil must be a valid Date or null');
      }
      this._scrapeCooldownUntil = new Date(value.getTime());
    } else {
      this._scrapeCooldownUntil = null;
    }
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
