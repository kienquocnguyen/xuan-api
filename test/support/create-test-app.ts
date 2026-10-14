import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module.js';
import { APP_CONFIG } from '../../src/config/app-config.module.js';
import { loadConfig, type AppConfig } from '../../src/config/load-config.js';
import { configureApp } from '../../src/http/configure-app.js';
import { assertTestDatabase, testDatabaseName } from './test-database-guard.js';

/** Same AppModule + same configureApp() as main.ts (D6). Refuses to start against a non-*_test database (I21). */
export async function createTestApp(extraImports: Type[] = []): Promise<NestExpressApplication> {
  testDatabaseName(loadConfig().database.url); // fail closed before any connection is opened
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...extraImports],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: ['error'],
  });
  const config = app.get<AppConfig>(APP_CONFIG);
  const [{ name }] = await app
    .get(DataSource)
    .query<{ name: string }[]>('SELECT current_database() AS name');
  assertTestDatabase(config.database.url, name);
  configureApp(app, config);
  await app.init();
  return app;
}
