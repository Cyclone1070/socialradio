export class User {
  private _id!: string;
  private _email!: string;
  private _passwordHash!: string;
  private _role: 'user' | 'admin' = 'user';
  private _createdAt!: Date;

  constructor(
    email?: string,
    passwordHash?: string,
    role?: 'user' | 'admin',
    id?: string,
    createdAt?: Date,
  ) {
    if (email !== undefined) this.email = email;
    if (passwordHash !== undefined) this.passwordHash = passwordHash;
    if (role !== undefined) this.role = role;
    if (id !== undefined) this._id = id;
    if (createdAt !== undefined) this._createdAt = createdAt;
  }

  get id(): string {
    return this._id;
  }

  private set id(value: string) {
    this._id = value;
  }

  get email(): string {
    return this._email;
  }

  set email(value: string) {
    const trimmed = value?.trim().toLowerCase();
    if (!trimmed) {
      throw new Error('email cannot be empty');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      throw new Error('invalid email format');
    }
    this._email = trimmed;
  }

  get passwordHash(): string {
    return this._passwordHash;
  }

  set passwordHash(value: string) {
    const trimmed = value?.trim();
    if (!trimmed) {
      throw new Error('passwordHash cannot be empty');
    }
    this._passwordHash = trimmed;
  }

  get role(): 'user' | 'admin' {
    return this._role;
  }

  set role(value: 'user' | 'admin') {
    if (value !== 'user' && value !== 'admin') {
      throw new Error('Invalid user role');
    }
    this._role = value;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  private set createdAt(value: Date) {
    this._createdAt = value;
  }
}
