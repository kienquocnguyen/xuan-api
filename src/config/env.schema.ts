import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.url(),
  CORS_ORIGINS: z
    .string()
    .transform((raw) =>
      raw
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .refine((origins) => origins.length > 0 && !origins.includes('*'), 'Exact origins only (I20).'),
  DOCS_ENABLED: z.stringbool().default(false),
});
