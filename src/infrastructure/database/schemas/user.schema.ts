import { EntitySchema } from '@mikro-orm/core';
import { User } from '../../../user/entities/user.entity';

export const UserSchema = new EntitySchema<User>({
  class: User,
  tableName: 'user',
  properties: {
    id: { type: 'uuid', primary: true, defaultRaw: 'gen_random_uuid()' },
    email: { type: 'string', unique: true },
    passwordHash: { type: 'string' },
    role: { type: 'string', default: 'user' },
    createdAt: {
      type: 'Date',
      onCreate: () => new Date(),
      defaultRaw: 'now()',
    },
  },
});
