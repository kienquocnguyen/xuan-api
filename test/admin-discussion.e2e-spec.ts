import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { signInAs, type TestUser, XHR } from './support/auth.js';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UNKNOWN_ID = '01900000-0000-7000-8000-000000000000';
const deletedError = {
  data: null,
  error: { code: 'COMMENT_DELETED', message: "A deleted comment can't be changed.", details: {} },
};

describe('Moderating discussion (/admin/post-comments, /admin/post-ratings, blog completion B4)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let admin: { user: TestUser; cookie: string };
  let reader: { user: TestUser; cookie: string };
  let postId: string;

  const server = () => request(app.getHttpServer());
  const act = (
    kind: 'post-comments' | 'post-ratings',
    id: string,
    verb: string,
    cookie = admin.cookie,
  ) => server().post(`/admin/${kind}/${id}/${verb}`).set(XHR).set('Cookie', cookie);
  const insertComment = async (body: string, at = 'now()') =>
    (
      await db.query<{ id: string }[]>(
        `INSERT INTO content_post_comments (post_id, user_id, body, created_at) VALUES ($1, $2, $3, ${at}) RETURNING id`,
        [postId, reader.user.id, body],
      )
    )[0].id;
  const insertRating = async (userId: string, value: number) =>
    (
      await db.query<{ id: string }[]>(
        'INSERT INTO content_post_ratings (post_id, user_id, value) VALUES ($1, $2, $3) RETURNING id',
        [postId, userId, value],
      )
    )[0].id;
  const updatedAt = async (table: string, id: string) =>
    (
      await db.query<{ updated_at: Date }[]>(`SELECT updated_at FROM ${table} WHERE id = $1`, [id])
    )[0].updated_at;
  const authorOf = (user: TestUser) => ({
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  });

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    admin = await signInAs(app, { role: 'admin', displayName: 'Quản trị' });
    reader = await signInAs(app, { role: 'user', displayName: 'Bạn đọc' });
    [{ id: postId }] = await db.query<{ id: string }[]>(
      `INSERT INTO content_posts (author_id, slug, title, body, status, published_at) VALUES ($1, 'bai-viet', 'Bài viết', '{"type":"doc","content":[]}', 'published', now()) RETURNING id`,
      [admin.user.id],
    );
  });
  afterAll(async () => {
    await app.close();
  });

  it('lists comments newest first in every status, filtered by status and post, without emails', async () => {
    const older = await insertComment('Cũ', "now() - interval '1 minute'");
    const newer = await insertComment('Mới');
    await act('post-comments', older, 'hide');
    const res = await server().get('/admin/post-comments').set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([
      {
        id: newer,
        post: { id: postId, slug: 'bai-viet', title: 'Bài viết' },
        author: authorOf(reader.user),
        body: 'Mới',
        status: 'visible',
        editedAt: null,
        moderatedAt: null,
        moderatedBy: null,
        createdAt: expect.stringMatching(ISO),
        updatedAt: expect.stringMatching(ISO),
      },
      {
        id: older,
        post: { id: postId, slug: 'bai-viet', title: 'Bài viết' },
        author: authorOf(reader.user),
        body: 'Cũ',
        status: 'hidden',
        editedAt: null,
        moderatedAt: expect.stringMatching(ISO),
        moderatedBy: authorOf(admin.user),
        createdAt: expect.stringMatching(ISO),
        updatedAt: expect.stringMatching(ISO),
      },
    ]);
    expect(res.body.data.pageInfo).toEqual({ page: 1, pageSize: 12, totalItems: 2, totalPages: 1 });
    expect(JSON.stringify(res.body)).not.toContain('@example.com');
    const hidden = await server()
      .get('/admin/post-comments?status=hidden')
      .set('Cookie', admin.cookie);
    expect(hidden.body.data.items.map((c: { id: string }) => c.id)).toEqual([older]);
    const elsewhere = await server()
      .get(`/admin/post-comments?postId=${UNKNOWN_ID}`)
      .set('Cookie', admin.cookie);
    expect(elsewhere.body.data.items).toEqual([]);
    expect(
      (await server().get('/admin/post-comments?status=gone').set('Cookie', admin.cookie)).status,
    ).toBe(400);
  });

  it('hides, restores and finally deletes a comment; repeats write nothing; deleted is terminal (Q2)', async () => {
    const id = await insertComment('Bình luận');
    const hidden = await act('post-comments', id, 'hide');
    expect(hidden.status).toBe(200);
    expect(hidden.body.data).toMatchObject({
      id,
      status: 'hidden',
      moderatedBy: authorOf(admin.user),
    });
    const stamp = await updatedAt('content_post_comments', id);
    expect((await act('post-comments', id, 'hide')).body.data.status).toBe('hidden');
    expect(await updatedAt('content_post_comments', id)).toEqual(stamp);
    expect((await act('post-comments', id, 'restore')).body.data.status).toBe('visible');
    expect((await server().get('/posts/bai-viet/comments')).body.data.items).toHaveLength(1);
    expect((await act('post-comments', id, 'delete')).body.data.status).toBe('deleted');
    for (const verb of ['hide', 'restore']) {
      const res = await act('post-comments', id, verb);
      expect(res.status).toBe(409);
      expect(res.body).toEqual(deletedError);
    }
    const again = await act('post-comments', id, 'delete');
    expect(again.status).toBe(200);
    expect(again.body.data.status).toBe('deleted');
    expect((await server().get('/posts/bai-viet/comments')).body.data.items).toEqual([]);
  });

  it("records an author's deletion of a hidden comment as the author's, not the admin's (final review)", async () => {
    const id = await insertComment('Bình luận');
    await act('post-comments', id, 'hide');
    const own = await server().delete(`/post-comments/${id}`).set(XHR).set('Cookie', reader.cookie);
    expect(own.status).toBe(204);
    const [listed] = (await server().get('/admin/post-comments').set('Cookie', admin.cookie)).body
      .data.items;
    expect(listed).toMatchObject({ id, status: 'deleted', moderatedBy: null, moderatedAt: null });
  });

  it('hides and restores ratings, which leave and rejoin the public summary', async () => {
    const id = await insertRating(reader.user.id, 2);
    await insertRating(admin.user.id, 4);
    const summary = async () => (await server().get('/posts/bai-viet')).body.data.ratingSummary;
    expect(await summary()).toEqual({ average: 3, count: 2 });
    const hidden = await act('post-ratings', id, 'hide');
    expect(hidden.status).toBe(200);
    expect(hidden.body.data).toEqual({
      id,
      post: { id: postId, slug: 'bai-viet', title: 'Bài viết' },
      author: authorOf(reader.user),
      value: 2,
      status: 'hidden',
      moderatedAt: expect.stringMatching(ISO),
      moderatedBy: authorOf(admin.user),
      createdAt: expect.stringMatching(ISO),
      updatedAt: expect.stringMatching(ISO),
    });
    expect(await summary()).toEqual({ average: 4, count: 1 });
    const list = await server()
      .get('/admin/post-ratings?status=hidden')
      .set('Cookie', admin.cookie);
    expect(list.body.data.items.map((r: { id: string }) => r.id)).toEqual([id]);
    expect((await act('post-ratings', id, 'restore')).body.data.status).toBe('visible');
    expect(await summary()).toEqual({ average: 3, count: 2 });
    expect((await act('post-ratings', id, 'delete')).status).toBe(404); // no such route: never deleted
  });

  it('is admin only, needs CSRF on actions, answers 404 for unknown ids and 400 for malformed ones', async () => {
    const id = await insertComment('a');
    const editor = await signInAs(app, { role: 'editor' });
    for (const cookie of [reader.cookie, editor.cookie]) {
      expect((await server().get('/admin/post-comments').set('Cookie', cookie)).status).toBe(403);
      expect((await act('post-comments', id, 'hide', cookie)).status).toBe(403);
    }
    expect((await server().get('/admin/post-ratings')).status).toBe(401);
    expect(
      (await server().post(`/admin/post-comments/${id}/hide`).set('Cookie', admin.cookie)).status,
    ).toBe(403);
    expect((await act('post-comments', UNKNOWN_ID, 'hide')).status).toBe(404);
    expect((await act('post-ratings', UNKNOWN_ID, 'hide')).status).toBe(404);
    expect((await act('post-comments', 'x', 'hide')).status).toBe(400);
  });

  it('is not throttled: an admin can act many times in a row', async () => {
    const id = await insertComment('a');
    for (let i = 0; i < 8; i += 1) {
      expect((await act('post-comments', id, i % 2 === 0 ? 'hide' : 'restore')).status).toBe(200);
    }
  });
});
