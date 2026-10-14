import { z } from 'zod';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) {
  loadEnvFile(envFile);
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  DOCS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type AppConfig = Readonly<{
  env: 'development' | 'test' | 'production';
  port: number;
  database: {
    url: string;
  };
  cors: {
    origins: string[];
  };
  docs: {
    enabled: boolean;
  };
}>;

export function loadConfig(): AppConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const variables = [
      ...new Set(
        result.error.issues
          .map((issue) => issue.path[0])
          .filter((key): key is string => typeof key === 'string'),
      ),
    ];

    throw new Error(`Invalid environment configuration: ${variables.join(', ')}`);
  }

  const env = result.data;

  return Object.freeze({
    env: env.NODE_ENV,
    port: env.PORT,
    database: Object.freeze({
      url: env.DATABASE_URL,
    }),
    cors: Object.freeze({
      origins: env.CORS_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    }),
    docs: Object.freeze({
      enabled: env.DOCS_ENABLED,
    }),
  });
}
