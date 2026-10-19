import * as bcrypt from 'bcrypt';
import { MikroORM, wrap } from '@mikro-orm/postgresql';
import config from '../../infrastructure/database/mikro-orm.config';
import { UserSchema } from '../../infrastructure/database/schemas/user.schema';
import { User } from './user.entity';

describe('UserEntity Invariants & Encapsulation', () => {
  it('normalizes and validates email', () => {
    const user = new User('  Alice@Example.COM  ', 'hash123');
    expect(user.email).toBe('alice@example.com');

    user.email = '  BOB@Test.org ';
    expect(user.email).toBe('bob@test.org');

    expect(() => new User('   ', 'hash')).toThrow('email cannot be empty');
    expect(() => new User('notanemail', 'hash')).toThrow(
      'invalid email format',
    );
  });

  it('validates user role', () => {
    const user = new User('test@example.com', 'hash', 'admin');
    expect(user.role).toBe('admin');

    user.role = 'user';
    expect(user.role).toBe('user');

    expect(() => {
      // @ts-expect-error runtime invalid value
      user.role = 'superadmin';
    }).toThrow('Invalid user role');
  });

  it('validates passwordHash', () => {
    const user = new User('test@example.com', 'hash123');
    expect(user['_passwordHash']).toBe('hash123');

    expect(() => {
      user.passwordHash = '   ';
    }).toThrow('passwordHash cannot be empty');
  });

  it('manages id and enforces read-only createdAt', () => {
    const unpersisted = new User('alice@example.com', 'hash');
    expect(unpersisted.createdAt).toBeUndefined();

    const persistedDate = new Date('2026-03-01T00:00:00Z');
    const persisted = new User(
      'bob@example.com',
      'hash',
      'user',
      'usr-123',
      persistedDate,
    );
    expect(persisted.createdAt).toEqual(persistedDate);
    expect(persisted.id).toBe('usr-123');

    const leaked = persisted.createdAt;
    leaked?.setTime(0);
    expect(persisted.createdAt?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('verifies password against passwordHash', async () => {
    const hash = await bcrypt.hash('secret123', 10);
    const user = new User('alice@example.com', hash);

    await expect(user.verifyPassword('secret123')).resolves.toBe(true);
    await expect(user.verifyPassword('wrongpassword')).resolves.toBe(false);
    await expect(user.verifyPassword('')).resolves.toBe(false);
  });
});

describe('User password hash persistence wiring', () => {
  let orm: MikroORM;

  const storedRow = (hash: string) => ({
    id: '11111111-1111-1111-1111-111111111111',
    email: 'ada@example.com',
    password_hash: hash,
    role: 'user' as const,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
  });

  beforeAll(async () => {
    orm = await MikroORM.init({
      ...config,
      connect: false,
      entities: [UserSchema],
    });
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it('loads a stored hash into the private field and keeps it out of serialisation', async () => {
    const hash = await bcrypt.hash('s3cret', 4);
    const user = orm.em.fork().map(User, storedRow(hash));

    await expect(user.verifyPassword('s3cret')).resolves.toBe(true);
    await expect(user.verifyPassword('wrong')).resolves.toBe(false);

    const serialized = JSON.stringify(wrap(user).toObject());
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('$2b$');
  });

  it('creates a user through the entity manager with a usable, private hash', async () => {
    const hash = await bcrypt.hash('s3cret', 4);

    const user = orm.em.fork().create(User, {
      email: 'grace@example.com',
      passwordHash: hash,
      role: 'user',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(user.email).toBe('grace@example.com');
    await expect(user.verifyPassword('s3cret')).resolves.toBe(true);
    await expect(user.verifyPassword('wrong')).resolves.toBe(false);
    expect(JSON.stringify(wrap(user).toObject())).not.toContain('$2b$');
  });
});
