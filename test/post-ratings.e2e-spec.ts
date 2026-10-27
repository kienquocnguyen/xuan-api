import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { APP_CONFIG } from '../src/config/app-config.module.js';
import type { AppConfig } from '../src/config/load-config.js';
import { signInAs, type TestUser, XHR } from './support/auth.js';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const notFound = {
  data: null,
  error: { code: 'NOT_FOUND', message: 'The requested resource was not found.', details: {} },
};
const rateLimited = {
  data: null,
  error: {
    code: 'RATE_LIMITED',
    message: 'Too many requests. Try again in a moment.',
    details: {},
  },
};

describe('Rating posts (PUT /posts/:slug/rating, blog completion B4)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let origin: string;
  let reader: { user: TestUser; cookie: string };

  const insertPost = async (slug: string, status = 'published') => {
    const [{ id }] = await db.query<{ id: string }[]>(
      `INSERT INTO content_posts (author_id, slug, title, body, status, published_at) VALUES ($1, $2, 'Bài', '{"type":"doc","content":[]}', $3::varchar, CASE WHEN $3::varchar = 'draft' THEN NULL ELSE now() END) RETURNING id`,
      [reader.user.id, slug, status],
    );
    return id;
  };
  const rate = (slug: string, body: unknown, cookie = reader.cookie) =>
    request(app.getHttpServer())
      .put(`/posts/${slug}/rating`)
      .set(XHR)
      .set('Cookie', cookie)
      .send(body as object);
  const ratings = () =>
    db.query<{ user_id: string; value: number; status: string }[]>(
      'SELECT user_id, value, status FROM content_post_ratings ORDER BY created_at',
    );

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    origin = app.get<AppConfig>(APP_CONFIG).cors.origins[0];
  });
  beforeEach(async () => {
    await resetDatabase(app);
    reader = await signInAs(app, { role: 'user' });
    await insertPost('bai-viet');
  });
  afterAll(async () => {
    await app.close();
  });

  it('records a rating with 204 and changes it on a second PUT, keeping one row', async () => {
    const first = await rate('bai-viet', { value: 4 });
    expect(first.status).toBe(204);
    expect(first.text).toBe('');
    expect(await ratings()).toEqual([{ user_id: reader.user.id, value: 4, status: 'visible' }]);
    expect((await rate('bai-viet', { value: 5 })).status).toBe(204);
    expect(await ratings()).toEqual([{ user_id: reader.user.id, value: 5, status: 'visible' }]);
  });

  it('keeps a hidden rating hidden when its author rates again (Review Focus 1)', async () => {
    await rate('bai-viet', { value: 4 });
    const [{ id: adminId }] = await db.query<{ id: string }[]>(
      `INSERT INTO users (email, display_name, role) VALUES ('a@example.com', 'A', 'admin') RETURNING id`,
    );
    await db.query(
      `UPDATE content_post_ratings SET status = 'hidden', moderated_by = $1, moderated_at = now()`,
      [adminId],
    );
    expect((await rate('bai-viet', { value: 2 })).status).toBe(204);
    expect(await ratings()).toEqual([{ user_id: reader.user.id, value: 2, status: 'hidden' }]);
  });

  it.each([{ value: 0 }, { value: 6 }, { value: 2.5 }, { value: '4' }, {}, { value: 3, extra: 1 }])(
    'rejects %o with 400',
    async (body) => {
      const res = await rate('bai-viet', body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(await ratings()).toEqual([]);
    },
  );

  it('answers 404 for a draft, archived or unknown post', async () => {
    await insertPost('nhap', 'draft');
    await insertPost('luu-tru', 'archived');
    for (const slug of ['nhap', 'luu-tru', 'khong-co']) {
      const res = await rate(slug, { value: 4 });
      expect(res.status).toBe(404);
      expect(res.body).toEqual(notFound);
    }
  });

  it('needs a session and the CSRF header', async () => {
    const guest = await request(app.getHttpServer())
      .put('/posts/bai-viet/rating')
      .set(XHR)
      .send({ value: 4 });
    expect(guest.status).toBe(401);
    const noHeader = await request(app.getHttpServer())
      .put('/posts/bai-viet/rating')
      .set('Cookie', reader.cookie)
      .send({ value: 4 });
    expect(noHeader.status).toBe(403);
  });

  it('stores one row for two concurrent first ratings (Review Focus 5)', async () => {
    const [a, b] = await Promise.all([
      rate('bai-viet', { value: 3 }),
      rate('bai-viet', { value: 5 }),
    ]);
    expect([a.status, b.status]).toEqual([204, 204]);
    expect(await ratings()).toHaveLength(1);
  });

  it('allows 5 writes a minute per user, then 429 with Retry-After; others and refusals are not counted', async () => {
    // Refused before the throttle: no CSRF header (403) and no session (401) never use the budget.
    for (let i = 0; i < 3; i += 1) {
      await request(app.getHttpServer())
        .put('/posts/bai-viet/rating')
        .set('Cookie', reader.cookie)
        .send({ value: 4 });
      await request(app.getHttpServer()).put('/posts/bai-viet/rating').set(XHR).send({ value: 4 });
    }
    for (let i = 0; i < 5; i += 1) expect((await rate('bai-viet', { value: 4 })).status).toBe(204);
    const limited = await rate('bai-viet', { value: 4 }).set('Origin', origin);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual(rateLimited);
    const retryAfter = Number(limited.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    // The web reads it cross-origin, so CORS must expose it.
    expect(limited.headers['access-control-expose-headers']).toContain('Retry-After');
    const other = await signInAs(app, { role: 'user' });
    expect((await rate('bai-viet', { value: 4 }, other.cookie)).status).toBe(204);
  });
});
