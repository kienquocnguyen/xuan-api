import { existsSync } from 'node:fs';
import type { z } from 'zod';
import { envSchema } from './env.schema.js';

export type AppConfig = Readonly<{
  env: 'development' | 'test' | 'production';
  port: number;
  database: Readonly<{ url: string }>;
  cors: Readonly<{ origins: readonly string[] }>;
  docs: Readonly<{ enabled: boolean }>;
  auth: Readonly<{
    google: Readonly<{ clientId: string; clientSecret: string; callbackUrl: string }>;
    /** Web app origin that sign-in redirects back to. */
    webUrl: string;
    /** Signs the OAuth state cookie. */
    cookieSecret: string;
    cookieSecure: boolean;
    sessionTtlDays: number;
    /** Verified Google emails that become admin on sign-in (bootstrap, never demotes). */
    adminEmails: readonly string[];
  }>;
  /** Blog media storage (blog completion spec §5.3): `disabled` answers uploads with 409, never a local fallback. */
  media: Readonly<{
    storage: 'local' | 'r2' | 'disabled';
    /** Public URL prefix of stored files, no trailing slash; null when disabled. */
    publicBaseUrl: string | null;
    /** Where the local adapter writes (git-ignored `storage/`); null unless local. */
    localDir: string | null;
    r2: Readonly<{
      accountId: string;
      accessKeyId: string;
      secretAccessKey: string;
      bucket: string;
    }> | null;
  }>;
}>;

export class ConfigError extends Error {}

/** Reads, validates, normalizes and freezes configuration. Throws ConfigError naming variables only (I5). */
export function loadConfig(source: NodeJS.ProcessEnv = readEnvironment()): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    throw new ConfigError(`Invalid configuration: ${names.join(', ')}`);
  }
  const env = result.data;
  return Object.freeze({
    env: env.NODE_ENV,
    port: env.PORT,
    database: Object.freeze({ url: env.DATABASE_URL }),
    cors: Object.freeze({ origins: Object.freeze([...env.CORS_ORIGINS]) }),
    docs: Object.freeze({ enabled: env.DOCS_ENABLED }),
    auth: Object.freeze({
      google: Object.freeze({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackUrl: env.GOOGLE_CALLBACK_URL,
      }),
      webUrl: new URL(env.AUTH_WEB_URL).origin,
      cookieSecret: env.AUTH_COOKIE_SECRET,
      cookieSecure: env.AUTH_COOKIE_SECURE,
      sessionTtlDays: env.AUTH_SESSION_TTL_DAYS,
      adminEmails: Object.freeze([...env.AUTH_ADMIN_EMAILS]),
    }),
    media: Object.freeze(mediaConfig(env)),
  });
}

type Env = z.infer<typeof envSchema>;

function mediaConfig(env: Env): AppConfig['media'] {
  const storage = env.MEDIA_STORAGE ?? 'local'; // production always sets it (schema)
  if (storage === 'disabled') return { storage, publicBaseUrl: null, localDir: null, r2: null };
  if (storage === 'r2') {
    return {
      storage,
      publicBaseUrl: env.MEDIA_PUBLIC_BASE_URL as string,
      localDir: null,
      r2: Object.freeze({
        accountId: env.R2_ACCOUNT_ID as string,
        accessKeyId: env.R2_ACCESS_KEY_ID as string,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY as string,
        bucket: env.R2_BUCKET as string,
      }),
    };
  }
  return {
    storage,
    publicBaseUrl: env.MEDIA_PUBLIC_BASE_URL ?? `http://localhost:${env.PORT}/media`,
    localDir:
      env.MEDIA_LOCAL_DIR ?? (env.NODE_ENV === 'test' ? 'storage/media-test' : 'storage/media'),
    r2: null,
  };
}

// The only place that touches process.env (I4). Local files are optional; production uses real env vars,
// which win over the file (loadEnvFile never overrides a variable that is already set; architecture.md §16).
function readEnvironment(): NodeJS.ProcessEnv {
  const file = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
  if (existsSync(file)) process.loadEnvFile(file);
  return process.env;
}
