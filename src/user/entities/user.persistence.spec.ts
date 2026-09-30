import * as bcrypt from 'bcrypt';
import { MikroORM, wrap } from '@mikro-orm/postgresql';
import config from '../../infrastructure/database/mikro-orm.config';
import { UserSchema } from '../../infrastructure/database/schemas/user.schema';
import { User } from './user.entity';

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
