import { Subreddit } from './subreddit.entity';
import { Comment } from './comment.entity';

export class Post {
  private _id!: string;
  private _subredditId!: string;
  private _subreddit?: Subreddit;
  private _redditId!: string;
  private _title!: string;
  private _body!: string;
  private _score!: number;
  private _redditCreatedAt!: Date;
  private _scrapedAt!: Date;
  private _comments: Comment[] = [];

  constructor(
    subreddit?: Subreddit,
    redditId?: string,
    title?: string,
    body?: string,
    score?: number,
    redditCreatedAt?: Date,
    scrapedAt?: Date,
    id?: string,
  ) {
    if (subreddit !== undefined) {
      this._subreddit = subreddit;
      if (subreddit.id) {
        this._subredditId = subreddit.id;
      }
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

  private set subredditId(value: string) {
    this._subredditId = value;
  }

  get subreddit(): Subreddit | undefined {
    return this._subreddit;
  }

  private set subreddit(value: Subreddit | undefined) {
    this._subreddit = value;
    if (value?.id) {
      this._subredditId = value.id;
    }
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
    return this._redditCreatedAt;
  }

  private set redditCreatedAt(value: Date) {
    this._redditCreatedAt = value;
  }

  get scrapedAt(): Date {
    return this._scrapedAt;
  }

  private set scrapedAt(value: Date) {
    this._scrapedAt = value;
  }

  get comments(): Comment[] {
    return this._comments;
  }

  set comments(value: Comment[]) {
    this._comments = value;
  }
}
