import { ConfigError, loadConfig } from './load-config.js';

const valid = {
  NODE_ENV: 'development',
  PORT: '4000',
  DATABASE_URL: 'postgres://xuan_app:s3cret@localhost:5433/xuan_dev',
  CORS_ORIGINS: 'http://localhost:3000, https://xuancreative.com',
  DOCS_ENABLED: 'true',
};

describe('loadConfig', () => {
  it('normalizes a valid environment', () => {
    expect(loadConfig(valid)).toEqual({
      env: 'development',
      port: 4000,
      database: { url: valid.DATABASE_URL },
      cors: { origins: ['http://localhost:3000', 'https://xuancreative.com'] },
      docs: { enabled: true },
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
