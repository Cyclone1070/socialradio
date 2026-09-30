export class Comment {
  private _id!: string;
  private _postId!: string;
  private _redditId!: string;
  private _body!: string;
  private _score!: number;
  private _parentRedditId: string | null = null;
  private _isOp: boolean = false;
  private _redditCreatedAt!: Date;

  constructor(
    postId?: string,
    redditId?: string,
    body?: string,
    score?: number,
    parentRedditId?: string | null,
    isOp?: boolean,
    redditCreatedAt?: Date,
    id?: string,
  ) {
    if (postId !== undefined) {
      this.postId = postId;
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

  set postId(value: string) {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new Error('postId cannot be empty');
    }
    this._postId = trimmed;
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

  private set score(value: number) {
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
}
