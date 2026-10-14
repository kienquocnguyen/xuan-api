import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuthFixtureModule } from './fixtures/auth-fixture.module.js';
import { signInAs, type TestUser, XHR } from './support/auth.js';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UNKNOWN_ID = '01900000-0000-7000-8000-000000000000';

const envelope = (code: string, message: string, details: object = {}) => ({
  data: null,
  error: { code, message, details },
});
const locked = envelope('ADMIN_ROLE_LOCKED', 'Admin roles cannot be changed here.');
const notFound = envelope('NOT_FOUND', 'The requested resource was not found.');
const forbidden = envelope('FORBIDDEN', 'You are not allowed to do this.');

describe('Admin editor management', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let admin: { user: TestUser; cookie: string };

  beforeAll(async () => {
    app = await createTestApp([AuthFixtureModule]);
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    admin = await signInAs(app, { role: 'admin', email: 'admin@example.com' });
  });
  afterAll(async () => {
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const grant = (id: string, cookie = admin.cookie) =>
    server().put(`/admin/editors/${id}`).set(XHR).set('Cookie', cookie);
  const revoke = (id: string, cookie = admin.cookie) =>
    server().delete(`/admin/editors/${id}`).set(XHR).set('Cookie', cookie);
  const roleOf = async (id: string) =>
    (await db.query<{ role: string }[]>('SELECT role FROM users WHERE id = $1', [id]))[0].role;

  describe('GET /admin/users', () => {
    it('lists every user as AdminUserDto, oldest first', async () => {
      const editor = await signInAs(app, { role: 'editor', email: 'editor@example.com' });
      const res = await server().get('/admin/users').set('Cookie', admin.cookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: [
          {
            id: admin.user.id,
            email: 'admin@example.com',
            displayName: admin.user.displayName,
            avatarUrl: null,
            role: 'admin',
            createdAt: expect.stringMatching(ISO),
          },
          {
            id: editor.user.id,
            email: 'editor@example.com',
            displayName: editor.user.displayName,
            avatarUrl: null,
            role: 'editor',
            createdAt: expect.stringMatching(ISO),
          },
        ],
      });
    });

    it('filters by role', async () => {
      const editor = await signInAs(app, { role: 'editor' });
      await signInAs(app, { role: 'user' });
      const res = await server().get('/admin/users?role=editor').set('Cookie', admin.cookie);
      expect(res.body.data.map((u: { id: string }) => u.id)).toEqual([editor.user.id]);
    });

    it.each([['role=owner'], ['page=2']])('rejects ?%s with 400', async (query) => {
      const res = await server().get(`/admin/users?${query}`).set('Cookie', admin.cookie);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it.each(['user', 'editor'] as const)('a %s gets 403', async (role) => {
      const caller = await signInAs(app, { role });
      const res = await server().get('/admin/users').set('Cookie', caller.cookie);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(forbidden);
    });

    it('no session gets 401', async () => {
      expect((await server().get('/admin/users')).status).toBe(401);
    });
  });

  describe('PUT /admin/editors/:userId', () => {
    it('promotes a user to editor', async () => {
      const target = await signInAs(app, { role: 'user', email: 'target@example.com' });
      const res = await grant(target.user.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: {
          id: target.user.id,
          email: 'target@example.com',
          displayName: target.user.displayName,
          avatarUrl: null,
          role: 'editor',
          createdAt: expect.stringMatching(ISO),
        },
      });
      expect(await roleOf(target.user.id)).toBe('editor');
    });

    it('is idempotent for an editor', async () => {
      const target = await signInAs(app, { role: 'editor' });
      const res = await grant(target.user.id);
      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('editor');
    });

    it('cannot touch an admin → 409 ADMIN_ROLE_LOCKED', async () => {
      const other = await signInAs(app, { role: 'admin' });
      const res = await grant(other.user.id);
      expect(res.status).toBe(409);
      expect(res.body).toEqual(locked);
      expect(await roleOf(other.user.id)).toBe('admin');
    });

    it('cannot demote the caller themself → 409', async () => {
      const res = await grant(admin.user.id);
      expect(res.status).toBe(409);
      expect(await roleOf(admin.user.id)).toBe('admin');
    });
  });

  describe('DELETE /admin/editors/:userId', () => {
    it('demotes an editor to user (the account stays)', async () => {
      const target = await signInAs(app, { role: 'editor' });
      const res = await revoke(target.user.id);
      expect(res.status).toBe(204);
      expect(res.text).toBe('');
      expect(await roleOf(target.user.id)).toBe('user');
    });

    it('is idempotent for a user', async () => {
      const target = await signInAs(app, { role: 'user' });
      expect((await revoke(target.user.id)).status).toBe(204);
      expect(await roleOf(target.user.id)).toBe('user');
    });

    it('cannot touch an admin, including the caller → 409', async () => {
      const other = await signInAs(app, { role: 'admin' });
      for (const id of [other.user.id, admin.user.id]) {
        const res = await revoke(id);
        expect(res.status).toBe(409);
        expect(res.body).toEqual(locked);
        expect(await roleOf(id)).toBe('admin');
      }
    });

    it("takes effect on the demoted editor's existing session at once", async () => {
      const editor = await signInAs(app, { role: 'editor' });
      const area = () => server().get('/__fixture/editor-area').set('Cookie', editor.cookie);
      expect((await area()).status).toBe(200);
      await revoke(editor.user.id);
      expect((await area()).status).toBe(403);
    });
  });

  describe('both routes', () => {
    it.each([
      ['PUT', grant],
      ['DELETE', revoke],
    ] as const)('%s: unknown user → 404 NOT_FOUND', async (_m, act) => {
      const res = await act(UNKNOWN_ID);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(notFound);
    });

    it.each([
      ['PUT', grant],
      ['DELETE', revoke],
    ] as const)('%s: malformed id → 400 INVALID_FORMAT', async (_m, act) => {
      const res = await act('not-a-uuid');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.fields).toEqual([
        expect.objectContaining({ field: 'userId', code: 'INVALID_FORMAT' }),
      ]);
    });

    it.each(['user', 'editor'] as const)(
      'a %s caller gets 403 and nothing changes',
      async (role) => {
        const caller = await signInAs(app, { role });
        const target = await signInAs(app, { role: 'user' });
        const res = await grant(target.user.id, caller.cookie);
        expect(res.status).toBe(403);
        expect((await revoke(target.user.id, caller.cookie)).status).toBe(403);
        expect(await roleOf(target.user.id)).toBe('user');
      },
    );

    it('no session → 401', async () => {
      const target = await signInAs(app, { role: 'user' });
      const res = await server().put(`/admin/editors/${target.user.id}`).set(XHR);
      expect(res.status).toBe(401);
    });

    it('missing CSRF header → 403 even for an admin', async () => {
      const target = await signInAs(app, { role: 'user' });
      const res = await server()
        .put(`/admin/editors/${target.user.id}`)
        .set('Cookie', admin.cookie);
      expect(res.status).toBe(403);
      expect(await roleOf(target.user.id)).toBe('user');
    });
  });
});
