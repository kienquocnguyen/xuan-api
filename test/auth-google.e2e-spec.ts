import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { GoogleIdentity } from '../src/modules/users/google/google-identity.gateway.js';
import { sessionCount, signInAs } from './support/auth.js';
import { createTestApp, fakeGoogle } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const WEB = 'http://localhost:3000';
const OWNER = 'owner@example.com';

const identity = (overrides: Partial<GoogleIdentity> = {}): GoogleIdentity => ({
  subject: 'google-sub-1',
  email: 'Xuan@Example.com',
  emailVerified: true,
  name: 'Xuân Nguyễn',
  picture: 'https://lh3.googleusercontent.com/a/photo.jpg',
  ...overrides,
});

const cookieNamed = (res: request.Response, name: string): string | undefined =>
  ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${name}=`));

const pairOf = (setCookie: string | undefined) => setCookie?.split(';')[0];

describe('Google sign-in', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let codes = 0;

  beforeAll(async () => {
    app = await createTestApp([], { adminEmails: [OWNER] });
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });
  afterAll(async () => {
    await app.close();
  });

  const start = async (returnTo?: string) => {
    const res = await request(app.getHttpServer())
      .get('/auth/google')
      .query(returnTo === undefined ? {} : { returnTo });
    const location = new URL(res.headers.location);
    return {
      res,
      state: location.searchParams.get('state') ?? '',
      oauthCookie: pairOf(cookieNamed(res, 'xc_oauth')) ?? '',
    };
  };

  /** Full round trip through the fake Google; returns the callback response. */
  const signIn = async (
    who: GoogleIdentity | 'fail',
    opts: { returnTo?: string; extraCookie?: string; query?: Record<string, string> } = {},
  ) => {
    const { state, oauthCookie } = await start(opts.returnTo);
    const code = `code-${++codes}`;
    if (who === 'fail') fakeGoogle(app).willFail(code);
    else fakeGoogle(app).willReturn(code, who);
    const cookies = [oauthCookie, opts.extraCookie].filter(Boolean).join('; ');
    const res = await request(app.getHttpServer())
      .get('/auth/google/callback')
      .query({ code, state, ...opts.query })
      .set('Cookie', cookies);
    return { res, code, state, oauthCookie, session: pairOf(cookieNamed(res, 'xc_session')) };
  };

  const me = (cookie: string | undefined) =>
    request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookie ?? '');

  const counts = async () => {
    const [row] = await db.query<{ users: number; identities: number }[]>(
      `SELECT (SELECT count(*)::int FROM users) AS users,
              (SELECT count(*)::int FROM auth_identities) AS identities`,
    );
    return row;
  };

  const failedWith = (res: request.Response, code: string) => {
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${WEB}/login?authError=${code}`);
    expect(cookieNamed(res, 'xc_session')).toBeUndefined();
  };

  describe('GET /auth/google', () => {
    it('redirects to Google with state, nonce and PKCE, and sets a signed state cookie', async () => {
      const { res, state } = await start('/dashboard');
      expect(res.status).toBe(302);
      const location = new URL(res.headers.location);
      expect(location.host).toBe('accounts.google.test');
      expect(state).toHaveLength(43);
      expect(location.searchParams.get('nonce')).toHaveLength(43);
      expect(location.searchParams.get('code_challenge')).toHaveLength(43);
      const cookie = cookieNamed(res, 'xc_oauth') ?? '';
      expect(cookie).toMatch(/^xc_oauth=s%3A/); // signed by cookie-parser
      expect(cookie).toMatch(/Max-Age=600/);
      expect(cookie).toMatch(/Path=\/auth\/google/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Lax/);
    });

    it.each([
      ['protocol-relative', '//evil.example'],
      ['absolute URL', 'https://evil.example/x'],
      ['backslash', '/\\evil.example'],
      ['too long', `/${'a'.repeat(600)}`],
    ])('rejects an unsafe returnTo (%s) with 400 VALIDATION_FAILED', async (_case, returnTo) => {
      const res = await request(app.getHttpServer()).get('/auth/google').query({ returnTo });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.fields[0].field).toBe('returnTo');
      expect(cookieNamed(res, 'xc_oauth')).toBeUndefined();
    });

    it('rejects unknown query parameters', async () => {
      const res = await request(app.getHttpServer()).get('/auth/google').query({ next: '/x' });
      expect(res.status).toBe(400);
    });
  });

  describe('callback: success', () => {
    it('creates the user and identity, opens a session and returns to the web app', async () => {
      const { res, session } = await signIn(identity(), { returnTo: '/services/x?y=1' });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`${WEB}/services/x?y=1`);
      const sessionCookie = cookieNamed(res, 'xc_session') ?? '';
      expect(sessionCookie).toMatch(/HttpOnly/);
      expect(sessionCookie).toMatch(/SameSite=Lax/);
      expect(sessionCookie).toMatch(/Path=\//);
      expect(sessionCookie).not.toMatch(/Domain=/);
      expect(sessionCookie).not.toMatch(/Secure/); // AUTH_COOKIE_SECURE=false in .env.test
      expect(cookieNamed(res, 'xc_oauth')).toMatch(/Expires=Thu, 01 Jan 1970/); // single-use state

      const meRes = await me(session);
      expect(meRes.status).toBe(200);
      expect(meRes.body).toEqual({
        data: {
          id: expect.any(String),
          email: 'xuan@example.com',
          displayName: 'Xuân Nguyễn',
          avatarUrl: 'https://lh3.googleusercontent.com/a/photo.jpg',
          role: 'user',
        },
      });
      const [row] = await db.query<
        { provider: string; provider_user_id: string; user_id: string }[]
      >('SELECT provider, provider_user_id, user_id FROM auth_identities');
      expect(row).toEqual({
        provider: 'google',
        provider_user_id: 'google-sub-1',
        user_id: meRes.body.data.id,
      });
    });

    it('returns to / when no returnTo was given', async () => {
      const { res } = await signIn(identity());
      expect(res.headers.location).toBe(`${WEB}/`);
    });

    it('reuses the same user for a returning identity and syncs the Google profile', async () => {
      const first = await signIn(identity());
      const firstId = (await me(first.session)).body.data.id;
      const second = await signIn(
        identity({ email: 'new@example.com', name: 'New Name', picture: undefined }),
      );
      const body = (await me(second.session)).body.data;
      expect(body).toEqual({
        id: firstId,
        email: 'new@example.com',
        displayName: 'New Name',
        avatarUrl: null,
        role: 'user',
      });
      expect(await counts()).toEqual({ users: 1, identities: 1 });
    });

    it('a sync never changes the role', async () => {
      const first = await signIn(identity());
      const id = (await me(first.session)).body.data.id;
      await db.query(`UPDATE users SET role = 'editor' WHERE id = $1`, [id]);
      const second = await signIn(identity({ name: 'Renamed' }));
      expect((await me(second.session)).body.data.role).toBe('editor');
    });

    it('replaces any session presented at sign-in (session fixation)', async () => {
      const old = await signInAs(app);
      const { session } = await signIn(identity(), { extraCookie: old.cookie });
      expect((await me(old.cookie)).status).toBe(401);
      expect((await me(session)).status).toBe(200);
      expect(await sessionCount(app)).toBe(1);
    });

    it('never puts the code, state or session token in the redirect', async () => {
      const { res, code, state, session } = await signIn(identity());
      const token = session?.split('=')[1] ?? '';
      expect(res.headers.location).not.toContain(code);
      expect(res.headers.location).not.toContain(state);
      expect(res.headers.location).not.toContain(token);
      expect(res.text).not.toContain(token);
    });
  });

  describe('callback: initial admin bootstrap (AUTH_ADMIN_EMAILS)', () => {
    it('a listed, verified email becomes admin on first sign-in', async () => {
      const { session } = await signIn(
        identity({ subject: 'owner-sub', email: 'Owner@Example.com' }),
      );
      expect((await me(session)).body.data.role).toBe('admin');
    });

    it('an existing listed user is promoted on a later sign-in', async () => {
      const first = await signIn(identity({ subject: 'owner-sub', email: OWNER }));
      const id = (await me(first.session)).body.data.id;
      await db.query(`UPDATE users SET role = 'user' WHERE id = $1`, [id]);
      const second = await signIn(identity({ subject: 'owner-sub', email: OWNER }));
      expect((await me(second.session)).body.data).toMatchObject({ id, role: 'admin' });
    });

    it('an unlisted email stays user', async () => {
      const { session } = await signIn(identity({ email: 'someone@example.com' }));
      expect((await me(session)).body.data.role).toBe('user');
    });
  });

  describe('callback: refusals', () => {
    it('unverified email → EMAIL_NOT_VERIFIED, nothing created (even when allowlisted)', async () => {
      const { res } = await signIn(identity({ email: OWNER, emailVerified: false }));
      failedWith(res, 'EMAIL_NOT_VERIFIED');
      expect(await counts()).toEqual({ users: 0, identities: 0 });
    });

    it('a new identity with an email another account uses → ACCOUNT_CONFLICT (no silent linking)', async () => {
      await signIn(identity({ subject: 'sub-a', email: 'shared@example.com' }));
      const { res } = await signIn(identity({ subject: 'sub-b', email: 'shared@example.com' }));
      failedWith(res, 'ACCOUNT_CONFLICT');
      expect(await counts()).toEqual({ users: 1, identities: 1 });
    });

    it("a sync that would take another account's email → ACCOUNT_CONFLICT", async () => {
      await signIn(identity({ subject: 'sub-a', email: 'a@example.com' }));
      await signIn(identity({ subject: 'sub-b', email: 'b@example.com' }));
      const { res } = await signIn(identity({ subject: 'sub-b', email: 'a@example.com' }));
      failedWith(res, 'ACCOUNT_CONFLICT');
      const emails = await db.query<{ email: string }[]>('SELECT email FROM users ORDER BY email');
      expect(emails.map((r) => r.email)).toEqual(['a@example.com', 'b@example.com']);
    });

    it('missing state cookie → GOOGLE_SIGN_IN_FAILED', async () => {
      const { state } = await start();
      fakeGoogle(app).willReturn('code-x', identity());
      const res = await request(app.getHttpServer())
        .get('/auth/google/callback')
        .query({ code: 'code-x', state });
      failedWith(res, 'GOOGLE_SIGN_IN_FAILED');
    });

    it('mismatched state → GOOGLE_SIGN_IN_FAILED', async () => {
      const { res } = await signIn(identity(), { query: { state: 'forged-state' } });
      failedWith(res, 'GOOGLE_SIGN_IN_FAILED');
      expect(await counts()).toEqual({ users: 0, identities: 0 });
    });

    it('tampered state cookie → GOOGLE_SIGN_IN_FAILED', async () => {
      const { state, oauthCookie } = await start();
      fakeGoogle(app).willReturn('code-t', identity());
      const tampered = oauthCookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
      const res = await request(app.getHttpServer())
        .get('/auth/google/callback')
        .query({ code: 'code-t', state })
        .set('Cookie', tampered);
      failedWith(res, 'GOOGLE_SIGN_IN_FAILED');
    });

    it('Google error (user cancelled) → GOOGLE_SIGN_IN_FAILED', async () => {
      const { res } = await signIn(identity(), { query: { error: 'access_denied' } });
      failedWith(res, 'GOOGLE_SIGN_IN_FAILED');
    });

    it('an unexpected server failure still redirects (GOOGLE_SIGN_IN_FAILED), never a JSON page', async () => {
      // 330 chars overflows users.email varchar(320): an unanticipated database error mid-sign-in.
      const { res } = await signIn(identity({ email: `${'a'.repeat(318)}@example.com` }));
      failedWith(res, 'GOOGLE_SIGN_IN_FAILED');
      expect(await counts()).toEqual({ users: 0, identities: 0 });
    });

    it('two concurrent first sign-ins of one identity both succeed onto one account', async () => {
      const [a, b] = await Promise.all([signIn(identity()), signIn(identity())]);
      for (const { res } of [a, b]) expect(res.headers.location).toBe(`${WEB}/`);
      expect(await counts()).toEqual({ users: 1, identities: 1 });
    });

    it('failing code exchange → GOOGLE_SIGN_IN_FAILED', async () => {
      const { res } = await signIn('fail');
      failedWith(res, 'GOOGLE_SIGN_IN_FAILED');
    });

    it('replaying a completed callback → GOOGLE_SIGN_IN_FAILED', async () => {
      const first = await signIn(identity());
      const replay = await request(app.getHttpServer())
        .get('/auth/google/callback')
        .query({ code: first.code, state: first.state })
        .set('Cookie', first.oauthCookie);
      failedWith(replay, 'GOOGLE_SIGN_IN_FAILED');
    });
  });
});
