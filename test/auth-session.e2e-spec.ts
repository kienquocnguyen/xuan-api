import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';
import { expireSession, sessionCount, signInAs, XHR } from './support/auth.js';

const unauthenticated = {
  data: null,
  error: { code: 'UNAUTHENTICATED', message: 'You need to sign in.', details: {} },
};

describe('Sessions, GET /auth/me and POST /auth/logout', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });
  afterAll(async () => {
    await app.close();
  });

  const me = (cookie?: string) => {
    const req = request(app.getHttpServer()).get('/auth/me');
    return cookie ? req.set('Cookie', cookie) : req;
  };

  it('returns exactly the current user DTO for a valid session', async () => {
    const { user, cookie } = await signInAs(app, {
      role: 'editor',
      displayName: 'Xuân',
      avatarUrl: 'https://lh3.example/a.jpg',
    });
    const res = await me(cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        id: user.id,
        email: user.email,
        displayName: 'Xuân',
        avatarUrl: 'https://lh3.example/a.jpg',
        role: 'editor',
      },
    });
  });

  it.each([
    ['no cookie', undefined],
    ['a garbage cookie', 'xc_session=abc'],
    ['an unknown token', `xc_session=${'A'.repeat(43)}`],
    ['an empty cookie', 'xc_session='],
    ['an over-long cookie', `xc_session=${'x'.repeat(5000)}`],
  ])('401 UNAUTHENTICATED with %s', async (_case, cookie) => {
    const res = await me(cookie);
    expect(res.status).toBe(401);
    expect(res.body).toEqual(unauthenticated);
  });

  it('401 for an expired session, and the expired row is removed', async () => {
    const { cookie, token } = await signInAs(app);
    await expireSession(app, token);
    const res = await me(cookie);
    expect(res.status).toBe(401);
    expect(res.body).toEqual(unauthenticated);
    expect(await sessionCount(app)).toBe(0);
  });

  it('logout ends the session and clears the cookie', async () => {
    const { cookie } = await signInAs(app);
    const res = await request(app.getHttpServer())
      .post('/auth/logout')
      .set(XHR)
      .set('Cookie', cookie);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/xc_session=;/);
    expect(setCookie).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(await sessionCount(app)).toBe(0);
    expect((await me(cookie)).status).toBe(401);
  });

  it('logout without a session is a no-op 204', async () => {
    const res = await request(app.getHttpServer()).post('/auth/logout').set(XHR);
    expect(res.status).toBe(204);
  });

  it('logout without the CSRF header → 403, session kept', async () => {
    const { cookie } = await signInAs(app);
    const res = await request(app.getHttpServer()).post('/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(await sessionCount(app)).toBe(1);
  });

  it('logout only ends the presented session', async () => {
    const a = await signInAs(app);
    const b = await signInAs(app);
    await request(app.getHttpServer()).post('/auth/logout').set(XHR).set('Cookie', a.cookie);
    expect((await me(b.cookie)).status).toBe(200);
  });

  it('public routes still work without a session', async () => {
    const res = await request(app.getHttpServer()).get('/services');
    expect(res.status).toBe(200);
  });
});
