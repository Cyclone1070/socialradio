import { Post } from './post.entity';

export class Comment {
  private _id!: string;
  private _postId!: string;
  private _post?: Post;
  private _redditId!: string;
  private _body!: string;
  private _score!: number;
  private _parentRedditId: string | null = null;
  private _isOp: boolean = false;
  private _redditCreatedAt!: Date;

  constructor(
    post?: Post,
    redditId?: string,
    body?: string,
    score?: number,
    parentRedditId?: string | null,
    isOp?: boolean,
    redditCreatedAt?: Date,
    id?: string,
  ) {
    if (post !== undefined) {
      this._post = post;
      if (post.id) {
        this._postId = post.id;
      }
    }
    if (redditId !== undefined) this._redditId = redditId;
    if (body !== undefined) this._body = body;
    if (score !== undefined) this._score = score;
    if (parentRedditId !== undefined) this._parentRedditId = parentRedditId;
    if (isOp !== undefined) this._isOp = isOp;
    if (redditCreatedAt !== undefined) this._redditCreatedAt = redditCreatedAt;
    if (id !== undefined) this._id = id;
  }

  get id(): string {
    return this._id;
  }

  private set id(value: string) {
    this._id = value;
  }

  get postId(): string {
    return this._postId;
  }

  private set postId(value: string) {
    this._postId = value;
  }

  get post(): Post | undefined {
    return this._post;
  }

  private set post(value: Post | undefined) {
    this._post = value;
    if (value?.id) {
      this._postId = value.id;
    }
  }

  get redditId(): string {
    return this._redditId;
  }

  private set redditId(value: string) {
    this._redditId = value;
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

  get parentRedditId(): string | null {
    return this._parentRedditId;
  }

  private set parentRedditId(value: string | null) {
    this._parentRedditId = value;
  }

  get isOp(): boolean {
    return this._isOp;
  }

  private set isOp(value: boolean) {
    this._isOp = value;
  }

  get redditCreatedAt(): Date {
    return this._redditCreatedAt;
  }

  private set redditCreatedAt(value: Date) {
    this._redditCreatedAt = value;
  }
}
