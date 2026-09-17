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
    return this._lastScrapedAt;
  }

  set lastScrapedAt(value: Date | null) {
    this._lastScrapedAt = value;
  }

  get scrapeStartedAt(): Date | null {
    return this._scrapeStartedAt;
  }

  set scrapeStartedAt(value: Date | null) {
    this._scrapeStartedAt = value;
  }

  get scrapeCooldownUntil(): Date | null {
    return this._scrapeCooldownUntil;
  }

  set scrapeCooldownUntil(value: Date | null) {
    this._scrapeCooldownUntil = value;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  private set createdAt(value: Date) {
    this._createdAt = value;
  }
}
