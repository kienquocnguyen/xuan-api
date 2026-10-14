import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './load-config.js';

const originalEnv = { ...process.env };

describe('loadConfig', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses port 4000 by default', () => {
    process.env.DATABASE_URL = 'postgresql://xuan_app:test@localhost:5433/xuan_dev';

    const config = loadConfig();

    expect(config.port).toBe(4000);
  });

  it('parses DOCS_ENABLED as a boolean', () => {
    process.env.DATABASE_URL = 'postgresql://xuan_app:test@localhost:5433/xuan_dev';
    process.env.DOCS_ENABLED = 'true';

    const config = loadConfig();

    expect(config.docs.enabled).toBe(true);
  });

  it('fails when DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;

    expect(() => loadConfig()).toThrow();
  });
});
