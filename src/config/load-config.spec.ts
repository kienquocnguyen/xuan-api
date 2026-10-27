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
      media: {
        storage: 'local',
        publicBaseUrl: 'http://localhost:4000/media',
        localDir: 'storage/media',
        r2: null,
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

  describe('media storage (blog completion spec §5.3, owner Q1)', () => {
    const production = {
      ...valid,
      NODE_ENV: 'production',
      AUTH_COOKIE_SECURE: 'true',
      GOOGLE_CALLBACK_URL: 'https://api.xuancreative.com/auth/google/callback',
    };
    const r2 = {
      MEDIA_STORAGE: 'r2',
      MEDIA_PUBLIC_BASE_URL: 'https://media.xuancreative.com',
      R2_ACCOUNT_ID: 'account-id',
      R2_ACCESS_KEY_ID: 'r2-key-id',
      R2_SECRET_ACCESS_KEY: 'r2-s3cret-value',
      R2_BUCKET: 'xuan-media',
    };
    const failureOf = (env: Record<string, string>) => {
      try {
        loadConfig(env);
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        return (error as Error).message;
      }
      throw new Error('expected a ConfigError');
    };

    it('uses a separate local folder for tests', () => {
      expect(loadConfig({ ...valid, NODE_ENV: 'test' }).media).toEqual({
        storage: 'local',
        publicBaseUrl: 'http://localhost:4000/media',
        localDir: 'storage/media-test',
        r2: null,
      });
    });

    it('requires an explicit choice in production and never local disk', () => {
      expect(failureOf(production)).toContain('MEDIA_STORAGE');
      expect(failureOf({ ...production, MEDIA_STORAGE: 'local' })).toContain('MEDIA_STORAGE');
    });

    it('starts production with uploads switched off, needing no R2 values', () => {
      expect(loadConfig({ ...production, MEDIA_STORAGE: 'disabled' }).media).toEqual({
        storage: 'disabled',
        publicBaseUrl: null,
        localDir: null,
        r2: null,
      });
    });

    it('keeps reading stored media while uploads are disabled, when a base URL is set (B3 fix)', () => {
      expect(
        loadConfig({
          ...production,
          MEDIA_STORAGE: 'disabled',
          MEDIA_PUBLIC_BASE_URL: 'https://media.xuancreative.com',
        }).media,
      ).toEqual({
        storage: 'disabled',
        publicBaseUrl: 'https://media.xuancreative.com',
        localDir: null,
        r2: null,
      });
      expect(
        failureOf({
          ...production,
          MEDIA_STORAGE: 'disabled',
          MEDIA_PUBLIC_BASE_URL: 'http://media.x',
        }),
      ).toContain('MEDIA_PUBLIC_BASE_URL');
    });

    it('configures R2 with an https base URL and never prints a secret', () => {
      expect(loadConfig({ ...production, ...r2 }).media).toEqual({
        storage: 'r2',
        publicBaseUrl: 'https://media.xuancreative.com',
        localDir: null,
        r2: {
          accountId: 'account-id',
          accessKeyId: 'r2-key-id',
          secretAccessKey: 'r2-s3cret-value',
          bucket: 'xuan-media',
        },
      });
      const missing = failureOf({ ...production, MEDIA_STORAGE: 'r2', R2_SECRET_ACCESS_KEY: 'x' });
      for (const name of [
        'MEDIA_PUBLIC_BASE_URL',
        'R2_ACCOUNT_ID',
        'R2_ACCESS_KEY_ID',
        'R2_BUCKET',
      ]) {
        expect(missing).toContain(name);
      }
      const insecure = failureOf({ ...production, ...r2, MEDIA_PUBLIC_BASE_URL: 'http://media.x' });
      expect(insecure).toContain('MEDIA_PUBLIC_BASE_URL');
      expect(insecure).not.toContain('r2-s3cret-value');
    });

    it('rejects a base URL with a trailing slash', () => {
      expect(
        failureOf({ ...valid, MEDIA_PUBLIC_BASE_URL: 'http://localhost:4000/media/' }),
      ).toContain('MEDIA_PUBLIC_BASE_URL');
    });
  });
});
