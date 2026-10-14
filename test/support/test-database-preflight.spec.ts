import { spawn } from 'node:child_process';
import { testDatabasePreflight } from './test-database-preflight.js';

const PASSWORD = 's3cret-pw';
const url = (path: string) => `postgresql://xuan_app:${PASSWORD}@localhost:5433${path}`;
const base = {
  NODE_ENV: 'test',
  PORT: '4000',
  CORS_ORIGINS: 'http://localhost:3000',
  GOOGLE_CLIENT_ID: 'test-client',
  GOOGLE_CLIENT_SECRET: 'test-secret',
  GOOGLE_CALLBACK_URL: 'http://localhost:4000/auth/google/callback',
  AUTH_WEB_URL: 'http://localhost:3000',
  AUTH_COOKIE_SECRET: 'c'.repeat(32),
} as const;

const refusals = [
  ['a development database', url('/xuan_dev')],
  ['a malformed URL', 'not a url'],
  ['a missing database name', url('/')],
] as const;

describe('testDatabasePreflight', () => {
  it('passes for xuan_test and reports only the database name', () => {
    const result = testDatabasePreflight({ ...base, DATABASE_URL: url('/xuan_test') });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('xuan_test');
    expect(result.message).not.toContain(PASSWORD);
  });

  it.each(refusals)('refuses %s without printing credentials', (_case, databaseUrl) => {
    const result = testDatabasePreflight({ ...base, DATABASE_URL: databaseUrl });
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain(PASSWORD);
    expect(result.message).not.toContain('xuan_app');
  });

  it('refuses a missing DATABASE_URL', () => {
    expect(testDatabasePreflight({ ...base }).ok).toBe(false);
  });

  it('does not trust NODE_ENV: NODE_ENV=test with a development database is refused', () => {
    expect(testDatabasePreflight({ ...base, DATABASE_URL: url('/xuan_dev') }).ok).toBe(false);
  });
});

// The real command, as `yarn test:db-guard` runs it before `migration:run`. Explicit env only (no inherited
// variables); local .env files never override a variable that is already set, so these values win.
describe('test:db-guard command', { timeout: 30_000 }, () => {
  const run = (databaseUrl: string) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--no-warnings', '--loader', 'ts-node/esm', 'test/support/test-database-preflight.cli.ts'],
        { env: { ...base, DATABASE_URL: databaseUrl } },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += String(chunk)));
      child.stderr.on('data', (chunk) => (stderr += String(chunk)));
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });

  it.concurrent('exits 0 for xuan_test', async () => {
    const result = await run(url('/xuan_test'));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('xuan_test');
    expect(result.stdout + result.stderr).not.toContain(PASSWORD);
  });

  it.concurrent.each(refusals)(
    'exits 1 for %s without printing credentials',
    async (_case, databaseUrl) => {
      const result = await run(databaseUrl);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Refusing to run/);
      expect(result.stdout + result.stderr).not.toContain(PASSWORD);
      expect(result.stdout + result.stderr).not.toContain('xuan_app');
    },
  );
});
