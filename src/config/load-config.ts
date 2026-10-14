import { existsSync } from 'node:fs';
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
  });
}

// The only place that touches process.env (I4). Local files are optional; production uses real env vars,
// which win over the file (loadEnvFile never overrides a variable that is already set; architecture.md §16).
function readEnvironment(): NodeJS.ProcessEnv {
  const file = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
  if (existsSync(file)) process.loadEnvFile(file);
  return process.env;
}
