import { Collection } from '@mikro-orm/core';
import { Comment } from './comment.entity';

export class Post {
  private _id!: string;
  private _subredditId!: string;
  private _redditId!: string;
  private _title!: string;
  private _body!: string;
  private _score: number = 0;
  private _redditCreatedAt!: Date;
  private _scrapedAt!: Date;
  private _comments = new Collection<Comment>(this);

  constructor(
    subredditId?: string,
    redditId?: string,
    title?: string,
    body?: string,
    score?: number,
    redditCreatedAt?: Date,
    scrapedAt?: Date,
    id?: string,
  ) {
    if (subredditId !== undefined) {
      this.subredditId = subredditId;
    }
    if (redditId !== undefined) this._redditId = redditId;
    if (title !== undefined) this._title = title;
    if (body !== undefined) this._body = body;
    if (score !== undefined) this._score = score;
    if (redditCreatedAt !== undefined) this._redditCreatedAt = redditCreatedAt;
    if (scrapedAt !== undefined) this._scrapedAt = scrapedAt;
    if (id !== undefined) this._id = id;
  }

  get id(): string {
    return this._id;
  }

  private set id(value: string) {
    this._id = value;
  }

  get subredditId(): string {
    return this._subredditId;
  }

  set subredditId(value: string) {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new Error('subredditId cannot be empty');
    }
    this._subredditId = trimmed;
  }

  get redditId(): string {
    return this._redditId;
  }

  private set redditId(value: string) {
    this._redditId = value;
  }

  get title(): string {
    return this._title;
  }

  private set title(value: string) {
    this._title = value;
  }

  get body(): string {
    return this._body;
  }

  private set body(value: string) {
    this._body = value;
  }

  get score(): number {
    return this._score;
  }

  set score(value: number) {
    this._score = value;
  }

  get redditCreatedAt(): Date {
    return this._redditCreatedAt
      ? new Date(this._redditCreatedAt.getTime())
      : this._redditCreatedAt;
  }

  private set redditCreatedAt(value: Date) {
    if (value !== undefined) {
      if (!(value instanceof Date) || isNaN(value.getTime())) {
        throw new Error('redditCreatedAt must be a valid Date');
      }
      this._redditCreatedAt = new Date(value.getTime());
    }
  }

  get scrapedAt(): Date {
    return this._scrapedAt
      ? new Date(this._scrapedAt.getTime())
      : this._scrapedAt;
  }

  private set scrapedAt(value: Date) {
    if (value !== undefined) {
      if (!(value instanceof Date) || isNaN(value.getTime())) {
        throw new Error('scrapedAt must be a valid Date');
      }
      this._scrapedAt = new Date(value.getTime());
    }
  }

  get comments(): Collection<Comment> {
    return this._comments;
  }

  private set comments(value: Collection<Comment>) {
    if (!(value instanceof Collection)) {
      throw new Error('comments must be an instance of Collection');
    }
    this._comments = value;
  }
}
