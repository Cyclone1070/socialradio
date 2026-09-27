import * as bcrypt from 'bcrypt';
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
    expect(user.passwordHash).toBe('hash123');

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
