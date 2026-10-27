import { z } from 'zod';

const commaList = (raw: string) =>
  raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.url(),
    CORS_ORIGINS: z
      .string()
      .transform(commaList)
      .refine(
        (origins) => origins.length > 0 && !origins.includes('*'),
        'Exact origins only (I20).',
      ),
    DOCS_ENABLED: z.stringbool().default(false),

    // Google sign-in and sessions (auth design spec §7)
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    GOOGLE_CALLBACK_URL: z.url(),
    AUTH_WEB_URL: z.url(),
    AUTH_COOKIE_SECRET: z.string().min(32),
    AUTH_COOKIE_SECURE: z.stringbool().default(true),
    AUTH_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    AUTH_ADMIN_EMAILS: z
      .string()
      .default('')
      .transform((raw) => commaList(raw).map((email) => email.toLowerCase()))
      .pipe(z.array(z.email())),

    // Blog media storage (blog completion spec §5.3, owner Q1). Secrets are never printed (I5).
    MEDIA_STORAGE: z.enum(['local', 'r2', 'disabled']).optional(),
    MEDIA_PUBLIC_BASE_URL: z.url().optional(),
    MEDIA_LOCAL_DIR: z.string().min(1).optional(),
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    const issue = (variable: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [variable], message });
    const web = new URL(env.AUTH_WEB_URL);
    if (web.origin !== env.AUTH_WEB_URL.replace(/\/$/, '')) {
      issue('AUTH_WEB_URL', 'Must be an origin, without a path.');
    } else if (!env.CORS_ORIGINS.includes(web.origin)) {
      issue('AUTH_WEB_URL', 'Must be one of CORS_ORIGINS.');
    }
    // Production chooses explicitly and never writes uploads to a local disk (no silent fallback, Q1).
    if (
      env.NODE_ENV === 'production' &&
      env.MEDIA_STORAGE !== 'r2' &&
      env.MEDIA_STORAGE !== 'disabled'
    ) {
      issue('MEDIA_STORAGE', 'Must be r2 or disabled in production.');
    }
    if (env.MEDIA_PUBLIC_BASE_URL?.endsWith('/')) {
      issue('MEDIA_PUBLIC_BASE_URL', 'Must not end with a slash.');
    }
    if (env.MEDIA_STORAGE === 'r2' && !env.MEDIA_PUBLIC_BASE_URL) {
      issue('MEDIA_PUBLIC_BASE_URL', 'Required with r2.');
    }
    // Media is served from its own origin in production (r2, or disabled but still reading it).
    if (
      (env.MEDIA_STORAGE === 'r2' || env.NODE_ENV === 'production') &&
      env.MEDIA_PUBLIC_BASE_URL &&
      new URL(env.MEDIA_PUBLIC_BASE_URL).protocol !== 'https:'
    ) {
      issue('MEDIA_PUBLIC_BASE_URL', 'Must use https.');
    }
    if (env.MEDIA_STORAGE === 'r2') {
      for (const name of [
        'R2_ACCOUNT_ID',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'R2_BUCKET',
      ] as const) {
        if (!env[name]) issue(name, 'Required with r2.');
      }
    }
    if (env.NODE_ENV === 'production') {
      if (!env.AUTH_COOKIE_SECURE) issue('AUTH_COOKIE_SECURE', 'Must be true in production.');
      if (new URL(env.GOOGLE_CALLBACK_URL).protocol !== 'https:') {
        issue('GOOGLE_CALLBACK_URL', 'Must use https in production.');
      }
    }
  });
