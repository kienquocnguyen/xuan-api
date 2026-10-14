import { loadConfig } from '../../src/config/load-config.js';
import { testDatabaseName } from './test-database-guard.js';

export type PreflightResult = Readonly<{ ok: boolean; message: string }>;

/**
 * Preflight for database-mutating test commands (I21), run before `migration:run`.
 * Resolves DATABASE_URL through loadConfig(), the same path as src/database/data-source.ts, then applies the
 * same *_test rule as createTestApp/resetDatabase. Messages name variables and the database only, never the URL.
 */
export function testDatabasePreflight(source?: NodeJS.ProcessEnv): PreflightResult {
  try {
    const name = testDatabaseName(loadConfig(source).database.url);
    return { ok: true, message: `Test database guard: "${name}" is a *_test database (I21).` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    return { ok: false, message: `Refusing to run: ${reason.replace(/^Refusing to run: /, '')}` };
  }
}
