import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module.js';
import { APP_CONFIG } from '../../src/config/app-config.module.js';
import { loadConfig, type AppConfig } from '../../src/config/load-config.js';
import { configureApp } from '../../src/http/configure-app.js';
import { GOOGLE_IDENTITY_GATEWAY } from '../../src/modules/users/google/google-identity.gateway.js';
import { FakeGoogleIdentityGateway } from './fake-google-identity.gateway.js';
import { assertTestDatabase, testDatabaseName } from './test-database-guard.js';

export type TestAppOptions = Readonly<{
  /** Overrides AUTH_ADMIN_EMAILS for this app only. */
  adminEmails?: readonly string[];
  /** Overrides the media storage settings for this app only (blog completion B3). */
  media?: Partial<AppConfig['media']>;
}>;

/**
 * Same AppModule + same configureApp() as main.ts (D6). Refuses to start against a non-*_test database (I21).
 * Google is always replaced by FakeGoogleIdentityGateway: e2e never contacts Google.
 */
export async function createTestApp(
  extraImports: Type[] = [],
  options: TestAppOptions = {},
): Promise<NestExpressApplication> {
  const loaded = loadConfig();
  testDatabaseName(loaded.database.url); // fail closed before any connection is opened
  const testConfig: AppConfig = {
    ...loaded,
    auth: options.adminEmails ? { ...loaded.auth, adminEmails: options.adminEmails } : loaded.auth,
    media: { ...loaded.media, ...options.media },
  };
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...extraImports],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(testConfig)
    .overrideProvider(GOOGLE_IDENTITY_GATEWAY)
    .useValue(new FakeGoogleIdentityGateway())
    .compile();
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

export function fakeGoogle(app: NestExpressApplication): FakeGoogleIdentityGateway {
  return app.get(GOOGLE_IDENTITY_GATEWAY);
}
