import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import * as schemas from './schemas';
import * as dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
  clientUrl:
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/socialradio',
  entities: Object.values(schemas),
  extensions: [Migrator],
  migrations: {
    path: './dist/infrastructure/database/migrations',
    pathTs: './src/infrastructure/database/migrations',
    glob: '!(*.d).{js,ts}',
    transactional: true,
    allOrNothing: true,
    dropTables: true,
    safe: false,
    emit: 'ts',
  },
  debug: false,
});
