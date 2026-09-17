import { EntitySchema } from '@mikro-orm/core';
import { User } from '../../../user/entities/user.entity';

export const UserSchema = new EntitySchema<User>({
  class: User,
  tableName: 'user',
  properties: {
    id: {
      type: 'uuid',
      primary: true,
      defaultRaw: 'gen_random_uuid()',
      accessor: true,
    },
    email: { type: 'string', unique: true, accessor: true },
    passwordHash: { type: 'string', accessor: true },
    role: { type: 'string', default: 'user', accessor: true },
    createdAt: {
      type: 'Date',
      defaultRaw: 'now()',
      accessor: true,
    },
  },
  checks: [
    {
      name: 'user_role_check',
      expression: "role in ('user', 'admin')",
    },
  ],
});
