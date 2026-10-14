import { ConfigError, loadConfig } from './load-config.js';

const valid = {
  NODE_ENV: 'development',
  PORT: '4000',
  DATABASE_URL: 'postgres://xuan_app:s3cret@localhost:5433/xuan_dev',
  CORS_ORIGINS: 'http://localhost:3000, https://xuancreative.com',
  DOCS_ENABLED: 'true',
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'google-s3cret',
  GOOGLE_CALLBACK_URL: 'http://localhost:4000/auth/google/callback',
  AUTH_WEB_URL: 'http://localhost:3000',
  AUTH_COOKIE_SECRET: 'x'.repeat(32),
  AUTH_COOKIE_SECURE: 'false',
  AUTH_SESSION_TTL_DAYS: '7',
  AUTH_ADMIN_EMAILS: ' Owner@Example.com , second@example.com',
};

describe('loadConfig', () => {
  it('normalizes a valid environment', () => {
    expect(loadConfig(valid)).toEqual({
      env: 'development',
      port: 4000,
      database: { url: valid.DATABASE_URL },
      cors: { origins: ['http://localhost:3000', 'https://xuancreative.com'] },
      docs: { enabled: true },
      auth: {
        google: {
          clientId: valid.GOOGLE_CLIENT_ID,
          clientSecret: valid.GOOGLE_CLIENT_SECRET,
          callbackUrl: valid.GOOGLE_CALLBACK_URL,
        },
        webUrl: 'http://localhost:3000',
        cookieSecret: valid.AUTH_COOKIE_SECRET,
        cookieSecure: false,
        sessionTtlDays: 7,
        adminEmails: ['owner@example.com', 'second@example.com'],
      },
    });
  });

  it('returns a frozen object', () => {
    const config = loadConfig(valid);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.cors.origins)).toBe(true);
  });

  it('defaults PORT to 4000 and DOCS_ENABLED to false', () => {
    const { PORT, DOCS_ENABLED, ...rest } = valid;
    const config = loadConfig(rest);
    expect(config.port).toBe(4000);
    expect(config.docs.enabled).toBe(false);
  });

  it.each([
    ['DATABASE_URL', { ...valid, DATABASE_URL: undefined }],
    ['NODE_ENV', { ...valid, NODE_ENV: 'staging' }],
    ['CORS_ORIGINS', { ...valid, CORS_ORIGINS: '*' }],
    ['DOCS_ENABLED', { ...valid, DOCS_ENABLED: 'maybe' }],
  ])('rejects an invalid %s and names it', (name, env) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(name);
  });

  it('defaults the cookie to Secure, sessions to 14 days and no admin emails', () => {
    const rest: Record<string, string> = { ...valid };
    for (const name of ['AUTH_COOKIE_SECURE', 'AUTH_SESSION_TTL_DAYS', 'AUTH_ADMIN_EMAILS'])
      delete rest[name];
    const config = loadConfig(rest);
    expect(config.auth.cookieSecure).toBe(true);
    expect(config.auth.sessionTtlDays).toBe(14);
    expect(config.auth.adminEmails).toEqual([]);
  });

  it.each([
    ['GOOGLE_CLIENT_ID', { ...valid, GOOGLE_CLIENT_ID: undefined }],
    ['GOOGLE_CLIENT_SECRET', { ...valid, GOOGLE_CLIENT_SECRET: '' }],
    ['GOOGLE_CALLBACK_URL', { ...valid, GOOGLE_CALLBACK_URL: 'not a url' }],
    ['AUTH_COOKIE_SECRET', { ...valid, AUTH_COOKIE_SECRET: 'too-short' }],
    ['AUTH_WEB_URL', { ...valid, AUTH_WEB_URL: 'http://localhost:5173' }],
    ['AUTH_WEB_URL', { ...valid, AUTH_WEB_URL: 'http://localhost:3000/app' }],
    ['AUTH_SESSION_TTL_DAYS', { ...valid, AUTH_SESSION_TTL_DAYS: '365' }],
    ['AUTH_ADMIN_EMAILS', { ...valid, AUTH_ADMIN_EMAILS: 'owner@example.com, not-an-email' }],
    ['AUTH_COOKIE_SECURE', { ...valid, NODE_ENV: 'production', AUTH_COOKIE_SECURE: 'false' }],
    ['GOOGLE_CALLBACK_URL', { ...valid, NODE_ENV: 'production', AUTH_COOKIE_SECURE: 'true' }],
  ])('rejects an invalid auth setting %s and names it', (name, env) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(name);
  });

  it('never prints a secret in the error', () => {
    const env = { ...valid, AUTH_COOKIE_SECRET: 'short-s3cret' };
    expect(() => loadConfig(env)).toThrow(/^Invalid configuration: AUTH_COOKIE_SECRET$/);
  });

  it('never prints a value in the error', () => {
    const env = { ...valid, PORT: 'not-a-port-s3cret' };
    expect(() => loadConfig(env)).toThrow(/^Invalid configuration: PORT$/);
  });

  it('documents loadEnvFile precedence', async () => {
    const { writeFileSync, rmSync } = await import('node:fs');
    writeFileSync('.env.precedence-probe', 'PROBE_VAR=from-file\n');
    process.env.PROBE_VAR = 'from-process';
    process.loadEnvFile('.env.precedence-probe');
    rmSync('.env.precedence-probe');
    expect(process.env.PROBE_VAR).toBe('from-process'); // if this fails, the file overrides real env: record it in architecture.md §16
    delete process.env.PROBE_VAR;
  });
});
