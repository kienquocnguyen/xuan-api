import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource, QueryFailedError } from 'typeorm';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const constraintOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof QueryFailedError) {
      return (error.driverError as { constraint?: string }).constraint;
    }
    throw error;
  }
  throw new Error('expected the statement to fail');
};

describe('users, auth_identities and sessions invariants', () => {
  let app: NestExpressApplication;
  let db: DataSource;

  // Raw SQL on purpose: these tests probe the database's own constraints, not the entities.
  const insertUser = async (
    email = 'a@example.com',
    extra: { display_name?: string; role?: string } = {},
  ) => {
    const [{ id }] = await db.query<{ id: string }[]>(
      `INSERT INTO users (email, display_name, role) VALUES ($1, $2, COALESCE($3, 'user')) RETURNING id`,
      [email, extra.display_name ?? 'A', extra.role ?? null],
    );
    return id;
  };

  const insertIdentity = (userId: string, providerUserId = 'sub-1', provider = 'google') =>
    db.query(
      'INSERT INTO auth_identities (user_id, provider, provider_user_id) VALUES ($1, $2, $3)',
      [userId, provider, providerUserId],
    );

  const insertSession = (userId: string, tokenHash = 'a'.repeat(64)) =>
    db.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
      [userId, tokenHash],
    );

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('fills uuid v7 ids, role user and timestamps by default', async () => {
    const id = await insertUser();
    const [row] = await db.query<
      { id: string; role: string; avatar_url: null; c: Date; u: Date }[]
    >('SELECT id, role, avatar_url, created_at AS c, updated_at AS u FROM users WHERE id = $1', [
      id,
    ]);
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(row.role).toBe('user');
    expect(row.avatar_url).toBeNull();
    expect(row.c).toBeInstanceOf(Date);
    expect(row.u).toBeInstanceOf(Date);
  });

  it.each([
    [
      'duplicate email',
      'uq_users_email',
      async () => {
        await insertUser('dup@example.com');
        return insertUser('dup@example.com');
      },
    ],
    ['uppercase email', 'ck_users_email_lowercase', () => insertUser('Upper@Example.com')],
    [
      'blank display name',
      'ck_users_display_name_not_blank',
      () => insertUser('b@example.com', { display_name: '  ' }),
    ],
    ['unknown role', 'ck_users_role', () => insertUser('c@example.com', { role: 'owner' })],
  ])('users rejects %s via %s', async (_case, constraint, act) => {
    expect(await constraintOf(act())).toBe(constraint);
  });

  it('one account per external identity', async () => {
    const a = await insertUser('a@example.com');
    const b = await insertUser('b@example.com');
    await insertIdentity(a, 'sub-1');
    expect(await constraintOf(insertIdentity(b, 'sub-1'))).toBe(
      'uq_auth_identities_provider_provider_user_id',
    );
  });

  it('one identity per provider per account', async () => {
    const a = await insertUser();
    await insertIdentity(a, 'sub-1');
    expect(await constraintOf(insertIdentity(a, 'sub-2'))).toBe(
      'uq_auth_identities_user_id_provider',
    );
  });

  it('only known providers', async () => {
    const a = await insertUser();
    expect(await constraintOf(insertIdentity(a, 'sub-1', 'facebook'))).toBe(
      'ck_auth_identities_provider',
    );
  });

  it.each([
    ['an identity', 'fk_auth_identities_user_id', (id: string) => insertIdentity(id)],
    ['a session', 'fk_sessions_user_id', (id: string) => insertSession(id)],
  ])('rejects %s for an unknown user via %s', async (_case, constraint, act) => {
    expect(await constraintOf(act('01900000-0000-7000-8000-000000000000'))).toBe(constraint);
  });

  it('token hashes are unique', async () => {
    const a = await insertUser();
    await insertSession(a);
    expect(await constraintOf(insertSession(a))).toBe('uq_sessions_token_hash');
  });

  it('deleting a user removes their identities and sessions', async () => {
    const a = await insertUser();
    await insertIdentity(a);
    await insertSession(a);
    await db.query('DELETE FROM users WHERE id = $1', [a]);
    const [{ identities, sessions }] = await db.query<{ identities: number; sessions: number }[]>(
      `SELECT (SELECT count(*)::int FROM auth_identities) AS identities,
              (SELECT count(*)::int FROM sessions) AS sessions`,
    );
    expect({ identities, sessions }).toEqual({ identities: 0, sessions: 0 });
  });
});
