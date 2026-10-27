import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { signInAs, type TestUser, XHR } from './support/auth.js';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UNKNOWN_ID = '01900000-0000-7000-8000-000000000000';
const notFound = {
  data: null,
  error: { code: 'NOT_FOUND', message: 'The requested resource was not found.', details: {} },
};
const notEditable = {
  data: null,
  error: {
    code: 'COMMENT_NOT_EDITABLE',
    message: 'Only a visible comment can be edited.',
    details: {},
  },
};

describe('Commenting on posts (blog completion B4, spec §6.2)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let reader: { user: TestUser; cookie: string };
  let postId: string;

  const server = () => request(app.getHttpServer());
  const insertPost = async (slug: string, status = 'published') => {
    const [{ id }] = await db.query<{ id: string }[]>(
      `INSERT INTO content_posts (author_id, slug, title, body, status, published_at) VALUES ($1, $2, 'Bài', '{"type":"doc","content":[]}', $3::varchar, CASE WHEN $3::varchar = 'draft' THEN NULL ELSE now() END) RETURNING id`,
      [reader.user.id, slug, status],
    );
    return id;
  };
  const write = (body: unknown, cookie = reader.cookie, slug = 'bai-viet') =>
    server().post(`/posts/${slug}/comments`).set(XHR).set('Cookie', cookie).send({ body });
  const edit = (id: string, body: unknown, cookie = reader.cookie) =>
    server().put(`/post-comments/${id}`).set(XHR).set('Cookie', cookie).send({ body });
  const remove = (id: string, cookie = reader.cookie) =>
    server().delete(`/post-comments/${id}`).set(XHR).set('Cookie', cookie);
  const row = async (id: string) =>
    (
      await db.query<{ body: string; status: string; edited_at: Date | null; updated_at: Date }[]>(
        'SELECT body, status, edited_at, updated_at FROM content_post_comments WHERE id = $1',
        [id],
      )
    )[0];
  const created = async (body = 'Hay quá') => {
    const res = await write(body);
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };
  const setStatus = (id: string, status: string) =>
    db.query(
      `UPDATE content_post_comments SET status = $2, moderated_by = $3, moderated_at = now() WHERE id = $1`,
      [id, status, reader.user.id],
    );

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    reader = await signInAs(app, {
      role: 'user',
      displayName: 'Bạn đọc',
      avatarUrl: 'https://lh3.googleusercontent.com/a/r',
    });
    postId = await insertPost('bai-viet');
  });
  afterAll(async () => {
    await app.close();
  });

  describe('POST /posts/:slug/comments', () => {
    it('creates a visible comment as the session user, without ids or emails of its author', async () => {
      const res = await write('  Hay quá\r\nCảm ơn  ');
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        data: {
          id: expect.any(String),
          body: 'Hay quá\nCảm ơn',
          createdAt: expect.stringMatching(ISO),
          editedAt: null,
          author: { displayName: 'Bạn đọc', avatarUrl: 'https://lh3.googleusercontent.com/a/r' },
        },
      });
      expect(JSON.stringify(res.body)).not.toContain(reader.user.id);
      const [stored] = await db.query<{ user_id: string; post_id: string; status: string }[]>(
        'SELECT user_id, post_id, status FROM content_post_comments',
      );
      expect(stored).toEqual({ user_id: reader.user.id, post_id: postId, status: 'visible' });
    });

    it('needs no rating: comments and ratings are independent (BD-6)', async () => {
      expect((await write('Chỉ bình luận')).status).toBe(201);
      expect(await db.query('SELECT 1 FROM content_post_ratings')).toEqual([]);
    });

    it.each([[' \n\t '], [''], ['a'.repeat(2001)], [42]])('rejects %j with 400', async (body) => {
      const res = await write(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('answers 404 on a draft, archived or unknown post; 401 for guests; 403 without CSRF', async () => {
      await insertPost('nhap', 'draft');
      await insertPost('luu-tru', 'archived');
      for (const slug of ['nhap', 'luu-tru', 'khong-co']) {
        const res = await write('a', reader.cookie, slug);
        expect(res.status).toBe(404);
        expect(res.body).toEqual(notFound);
      }
      expect(
        (await server().post('/posts/bai-viet/comments').set(XHR).send({ body: 'a' })).status,
      ).toBe(401);
      expect(
        (
          await server()
            .post('/posts/bai-viet/comments')
            .set('Cookie', reader.cookie)
            .send({ body: 'a' })
        ).status,
      ).toBe(403);
    });
  });

  describe('PUT /post-comments/:commentId', () => {
    it('lets the author edit a visible comment and records editedAt', async () => {
      const id = await created();
      const res = await edit(id, 'Sửa lại');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: {
          id,
          body: 'Sửa lại',
          createdAt: expect.stringMatching(ISO),
          editedAt: expect.stringMatching(ISO),
          author: { displayName: 'Bạn đọc', avatarUrl: 'https://lh3.googleusercontent.com/a/r' },
        },
      });
    });

    it('refuses another user (403), a hidden or deleted comment (409) and an unknown one (404)', async () => {
      const id = await created();
      const other = await signInAs(app, { role: 'editor' });
      const foreign = await edit(id, 'Không', other.cookie);
      expect(foreign.status).toBe(403);
      expect(foreign.body.error.code).toBe('FORBIDDEN');
      for (const status of ['hidden', 'deleted']) {
        await setStatus(id, status);
        const res = await edit(id, 'Không');
        expect(res.status).toBe(409);
        expect(res.body).toEqual(notEditable);
      }
      expect((await row(id)).body).toBe('Hay quá');
      expect((await edit(UNKNOWN_ID, 'a')).body).toEqual(notFound);
      expect((await edit('khong-phai-uuid', 'a')).status).toBe(400);
    });
  });

  describe('DELETE /post-comments/:commentId', () => {
    it('soft-deletes for its author with 204; a repeat is 204 with no write', async () => {
      const id = await created();
      const first = await remove(id);
      expect(first.status).toBe(204);
      expect(first.text).toBe('');
      const deleted = await row(id);
      expect(deleted.status).toBe('deleted');
      const again = await remove(id);
      expect(again.status).toBe(204);
      expect((await row(id)).updated_at).toEqual(deleted.updated_at);
    });

    it('lets the author delete a hidden comment; others get 403', async () => {
      const id = await created();
      const other = await signInAs(app, { role: 'admin' });
      expect((await remove(id, other.cookie)).status).toBe(403);
      await setStatus(id, 'hidden');
      expect((await remove(id)).status).toBe(204);
      expect((await row(id)).status).toBe('deleted');
    });
  });

  // One status per test: the 404s still use the write budget (the throttle runs before the handler).
  it.each(['draft', 'archived'])(
    'answers 404 on every write once the post is %s (Review Focus 4)',
    async (status) => {
      const id = await created();
      await db.query('UPDATE content_posts SET status = $1 WHERE id = $2', [status, postId]);
      expect((await write('a')).status).toBe(404);
      expect((await edit(id, 'a')).body).toEqual(notFound);
      expect((await remove(id)).body).toEqual(notFound);
      expect((await row(id)).status).toBe('visible');
    },
  );

  describe('GET /posts/:slug/comments and /discussion/me', () => {
    const insertComment = (userId: string, body: string, status = 'visible', at = 'now()') =>
      db.query<{ id: string }[]>(
        `INSERT INTO content_post_comments (post_id, user_id, body, status, moderated_by, moderated_at, created_at) VALUES ($1, $2, $3, $4::varchar, CASE WHEN $4::varchar = 'hidden' THEN $2::uuid END, CASE WHEN $4::varchar = 'hidden' THEN now() END, ${at}) RETURNING id`,
        [postId, userId, body, status],
      );

    it('lists visible comments only, oldest first, 10 a page by default, publicly', async () => {
      const [{ id: first }] = await insertComment(
        reader.user.id,
        'Một',
        'visible',
        "now() - interval '2 minutes'",
      );
      await insertComment(reader.user.id, 'Ẩn', 'hidden', "now() - interval '1 minute'");
      await insertComment(reader.user.id, 'Xoá', 'deleted');
      const [{ id: second }] = await insertComment(reader.user.id, 'Hai');
      const res = await server().get('/posts/bai-viet/comments');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: {
          items: [
            {
              id: first,
              body: 'Một',
              createdAt: expect.stringMatching(ISO),
              editedAt: null,
              author: {
                displayName: 'Bạn đọc',
                avatarUrl: 'https://lh3.googleusercontent.com/a/r',
              },
            },
            {
              id: second,
              body: 'Hai',
              createdAt: expect.stringMatching(ISO),
              editedAt: null,
              author: {
                displayName: 'Bạn đọc',
                avatarUrl: 'https://lh3.googleusercontent.com/a/r',
              },
            },
          ],
          pageInfo: { page: 1, pageSize: 10, totalItems: 2, totalPages: 1 },
        },
      });
      expect(JSON.stringify(res.body)).not.toContain(reader.user.id);
      expect(JSON.stringify(res.body)).not.toContain('@example.com');
      const paged = await server().get('/posts/bai-viet/comments?page=2&pageSize=1');
      expect(paged.body.data.items.map((c: { id: string }) => c.id)).toEqual([second]);
      for (const query of ['pageSize=51', 'pageSize=0', 'foo=1']) {
        expect((await server().get(`/posts/bai-viet/comments?${query}`)).status).toBe(400);
      }
    });

    it('answers 404 for comments of a draft, archived or unknown post', async () => {
      await insertPost('nhap', 'draft');
      await insertPost('luu-tru', 'archived');
      for (const slug of ['nhap', 'luu-tru', 'khong-co']) {
        const res = await server().get(`/posts/${slug}/comments`);
        expect(res.status).toBe(404);
        expect(res.body).toEqual(notFound);
        const mine = await server()
          .get(`/posts/${slug}/discussion/me`)
          .set('Cookie', reader.cookie);
        expect(mine.body).toEqual(notFound);
      }
    });

    it('tells the reader their rating (any status) and their visible comments, newest first', async () => {
      const empty = await server()
        .get('/posts/bai-viet/discussion/me')
        .set('Cookie', reader.cookie);
      expect(empty.status).toBe(200);
      expect(empty.body).toEqual({ data: { rating: null, ownCommentIds: [] } });
      const [{ id: older }] = await insertComment(
        reader.user.id,
        'Cũ',
        'visible',
        "now() - interval '1 minute'",
      );
      const [{ id: newer }] = await insertComment(reader.user.id, 'Mới');
      await insertComment(reader.user.id, 'Ẩn', 'hidden');
      const other = await signInAs(app, { role: 'user' });
      await insertComment(other.user.id, 'Người khác');
      await db.query(
        `INSERT INTO content_post_ratings (post_id, user_id, value, status, moderated_by, moderated_at) VALUES ($1, $2, 3, 'hidden', $2, now())`,
        [postId, reader.user.id],
      );
      const mine = await server().get('/posts/bai-viet/discussion/me').set('Cookie', reader.cookie);
      expect(mine.body).toEqual({ data: { rating: 3, ownCommentIds: [newer, older] } });
      expect((await server().get('/posts/bai-viet/discussion/me')).status).toBe(401);
    });

    it('summarizes visible ratings on the public post DTOs (Review Focus 1)', async () => {
      const raters = await Promise.all([1, 2, 3].map(() => signInAs(app, { role: 'user' })));
      for (const [i, value] of [4, 4, 5].entries()) {
        await db.query(
          'INSERT INTO content_post_ratings (post_id, user_id, value) VALUES ($1, $2, $3)',
          [postId, raters[i].user.id, value],
        );
      }
      await db.query(
        `INSERT INTO content_post_ratings (post_id, user_id, value, status, moderated_by, moderated_at) VALUES ($1, $2, 1, 'hidden', $2, now())`,
        [postId, reader.user.id],
      );
      const summary = { average: 4.33, count: 3 };
      expect((await server().get('/posts')).body.data.items[0].ratingSummary).toEqual(summary);
      expect((await server().get('/posts/bai-viet')).body.data.ratingSummary).toEqual(summary);
    });
  });

  it('shares one write budget with ratings (Review Focus 3)', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect(
        (
          await server()
            .put('/posts/bai-viet/rating')
            .set(XHR)
            .set('Cookie', reader.cookie)
            .send({ value: 4 })
        ).status,
      ).toBe(204);
    }
    const id = await created();
    expect((await edit(id, 'Sửa')).status).toBe(200);
    const limited = await remove(id);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect((await row(id)).status).toBe('visible');
  });
});
