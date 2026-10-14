import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Role } from '../../src/http/auth/role.js';

export const SESSION_COOKIE = 'xc_session';
/** Header every state-changing request needs (CSRF guard). */
export const XHR = { 'X-Requested-With': 'XMLHttpRequest' } as const;

export type TestUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: Role;
};

/**
 * Creates a user and a live session directly in the database, independent of the code under test, and
 * returns the cookie header value. For tests that need "someone signed in", not the Google flow.
 */
export async function signInAs(
  app: INestApplication,
  overrides: Partial<Omit<TestUser, 'id'>> = {},
): Promise<{ user: TestUser; cookie: string; token: string }> {
  const db = app.get(DataSource);
  const role = overrides.role ?? 'user';
  const email = overrides.email ?? `${role}-${randomUUID()}@example.test`;
  const displayName = overrides.displayName ?? `Test ${role}`;
  const avatarUrl = overrides.avatarUrl ?? null;
  const [{ id }] = await db.query<{ id: string }[]>(
    'INSERT INTO users (email, display_name, avatar_url, role) VALUES ($1, $2, $3, $4) RETURNING id',
    [email, displayName, avatarUrl, role],
  );
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
    [id, sha256(token)],
  );
  return {
    user: { id, email, displayName, avatarUrl, role },
    cookie: `${SESSION_COOKIE}=${token}`,
    token,
  };
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export async function expireSession(app: INestApplication, token: string): Promise<void> {
  await app
    .get(DataSource)
    .query(`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1`, [
      sha256(token),
    ]);
}

export async function sessionCount(app: INestApplication): Promise<number> {
  const [{ n }] = await app
    .get(DataSource)
    .query<{ n: number }[]>('SELECT count(*)::int AS n FROM sessions');
  return n;
}
