import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { APP_CONFIG } from '../../src/config/app-config.module.js';
import type { AppConfig } from '../../src/config/load-config.js';
import { assertTestDatabase } from './test-database-guard.js';

/** Destructive: refuses unless DATABASE_URL names a *_test database and the live connection is that database (I21). */
export async function resetDatabase(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);
  const [{ name }] = await dataSource.query<{ name: string }[]>(
    'SELECT current_database() AS name',
  );
  assertTestDatabase(app.get<AppConfig>(APP_CONFIG).database.url, name);
  const tables = await dataSource.query<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations'`,
  );
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await dataSource.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
