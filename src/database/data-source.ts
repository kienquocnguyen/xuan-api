import { DataSource } from 'typeorm';
import { loadConfig } from '../config/load-config.js';

const config = loadConfig();

// Used only by the TypeORM CLI (typeorm-ts-node-esm, architecture.md §16) and later the seed script.
// Globs are strings, not imports, so they don't break the I2 allow-list.
export default new DataSource({
  type: 'postgres',
  url: config.database.url,
  entities: ['src/modules/**/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  migrationsTableName: 'migrations',
  synchronize: false,
});
