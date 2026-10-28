import pg from 'pg';
import type { AppConfig } from '../config/load-config.js';
import { databaseOptions } from './database.module.js';

const config = (env: AppConfig['env']) =>
  ({ env, database: { url: 'postgres://xuan_app:s3cret@localhost:5433/xuan_dev' } }) as AppConfig;

describe('databaseOptions', () => {
  it('hands TypeORM the pg driver, a bounded connect timeout and no automatic schema changes', () => {
    expect(databaseOptions(config('development'))).toEqual({
      type: 'postgres',
      driver: pg,
      url: 'postgres://xuan_app:s3cret@localhost:5433/xuan_dev',
      connectTimeoutMS: 10_000,
      autoLoadEntities: true,
      synchronize: false,
      migrationsRun: false,
    });
  });

  it('fails fast in production: two attempts, one second apart, with the cause logged', () => {
    expect(databaseOptions(config('production'))).toMatchObject({
      connectTimeoutMS: 10_000,
      retryAttempts: 2,
      retryDelay: 1_000,
      verboseRetryLog: true,
    });
  });

  it("keeps Nest's default retries locally and in tests", () => {
    for (const env of ['development', 'test'] as const) {
      expect(databaseOptions(config(env))).not.toHaveProperty('retryAttempts');
    }
  });
});
