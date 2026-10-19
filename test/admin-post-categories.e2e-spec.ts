import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { signInAs, type TestUser, XHR } from './support/auth.js';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UNKNOWN_ID = '01900000-0000-7000-8000-000000000000';
const envelope = (code: string, message: string, details: object = {}) => ({
  data: null,
  error: { code, message, details },
});
const forbidden = envelope('FORBIDDEN', 'You are not allowed to do this.');
const notFound = envelope('NOT_FOUND', 'The requested resource was not found.');
const keyTaken = envelope('CATEGORY_KEY_TAKEN', 'Another category already uses this key.');
const slugTaken = envelope('CATEGORY_SLUG_TAKEN', 'Another category already uses this slug.');
const inUse = envelope('CATEGORY_IN_USE', 'Posts still use this category; archive it instead.');

describe('Managing post categories (/admin/post-categories, blog completion B2)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let admin: { user: TestUser; cookie: string };
  let editor: { user: TestUser; cookie: string };

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    admin = await signInAs(app, { role: 'admin' });
    editor = await signInAs(app, { role: 'editor' });
  });
  afterAll(async () => {
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const create = (input: object, cookie = admin.cookie) =>
    server().post('/admin/post-categories').set(XHR).set('Cookie', cookie).send(input);
  const update = (id: string, input: object, cookie = admin.cookie) =>
    server().put(`/admin/post-categories/${id}`).set(XHR).set('Cookie', cookie).send(input);
  const action = (id: string, verb: 'archive' | 'restore', cookie = admin.cookie) =>
    server().post(`/admin/post-categories/${id}/${verb}`).set(XHR).set('Cookie', cookie);
  const remove = (id: string, cookie = admin.cookie) =>
    server().delete(`/admin/post-categories/${id}`).set(XHR).set('Cookie', cookie);
  const list = (cookie = admin.cookie) =>
    server().get('/admin/post-categories').set('Cookie', cookie);
  const createdId = async (key: string, label = key, slug = key) => {
    const res = await create({ key, slug, label });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };
  const attachPost = (categoryId: string, slug = 'bai') =>
    db.query(
      `INSERT INTO content_posts (author_id, slug, title, body, category_id) VALUES ($1, $2, 'Bài', '{"type":"doc","content":[]}', $3)`,
      [editor.user.id, slug, categoryId],
    );

  it('creates a category with its Vietnamese name', async () => {
    const res = await create({ key: 'du-lich', slug: 'du-lich', label: '  Du lịch ' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      data: {
        id: expect.any(String),
        key: 'du-lich',
        slug: 'du-lich',
        label: 'Du lịch',
        status: 'active',
        postCount: 0,
        createdAt: expect.stringMatching(ISO),
        updatedAt: expect.stringMatching(ISO),
      },
    });
  });

  it('lists every category in Vietnamese label order with post counts of every status', async () => {
    const bep = await createdId('bep', 'Bếp');
    await createdId('da-lat', 'Đà Lạt');
    await createdId('anh', 'Ảnh');
    await attachPost(bep, 'mot');
    await attachPost(bep, 'hai');
    await action(bep, 'archive');
    const res = await list();
    expect(res.status).toBe(200);
    expect(
      res.body.data.map((c: { label: string; status: string; postCount: number }) => [
        c.label,
        c.status,
        c.postCount,
      ]),
    ).toEqual([
      ['Ảnh', 'active', 0],
      ['Bếp', 'archived', 2],
      ['Đà Lạt', 'active', 0],
    ]);
  });

  it('rejects a duplicate key and a duplicate slug', async () => {
    await createdId('du-lich');
    const sameKey = await create({ key: 'du-lich', slug: 'khac', label: 'Khác' });
    expect(sameKey.status).toBe(409);
    expect(sameKey.body).toEqual(keyTaken);
    const sameSlug = await create({ key: 'khac', slug: 'du-lich', label: 'Khác' });
    expect(sameSlug.status).toBe(409);
    expect(sameSlug.body).toEqual(slugTaken);
  });

  it('updates the slug and label; the key is not input', async () => {
    const id = await createdId('du-lich');
    await createdId('am-thuc');
    const res = await update(id, { slug: 'di-choi', label: 'Đi chơi' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ key: 'du-lich', slug: 'di-choi', label: 'Đi chơi' });
    const withKey = await update(id, { key: 'x', slug: 'di-choi', label: 'Đi chơi' });
    expect(withKey.status).toBe(400);
    expect(withKey.body.error.details.fields).toEqual([
      { field: 'key', code: 'UNKNOWN_FIELD', message: 'This field is not allowed.' },
    ]);
    const taken = await update(id, { slug: 'am-thuc', label: 'X' });
    expect(taken.body).toEqual(slugTaken);
    expect((await update(UNKNOWN_ID, { slug: 'a', label: 'A' })).body).toEqual(notFound);
  });

  it('archives and restores idempotently, without touching updatedAt on a repeat', async () => {
    const id = await createdId('du-lich');
    const archived = await action(id, 'archive');
    expect(archived.body.data.status).toBe('archived');
    const again = await action(id, 'archive');
    expect(again.body.data.updatedAt).toBe(archived.body.data.updatedAt);
    const restored = await action(id, 'restore');
    expect(restored.body.data.status).toBe('active');
    const restoredAgain = await action(id, 'restore');
    expect(restoredAgain.body.data.updatedAt).toBe(restored.body.data.updatedAt);
  });

  it('deletes an unused category, and refuses one any post uses', async () => {
    const unused = await createdId('trong');
    const res = await remove(unused);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(await db.query('SELECT 1 FROM content_category_translations')).toEqual([]);

    const used = await createdId('dung');
    await attachPost(used);
    const refused = await remove(used);
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual(inUse);
    expect((await remove(UNKNOWN_ID)).body).toEqual(notFound);
  });

  it('is admin-only, needs a session and the CSRF header', async () => {
    const id = await createdId('du-lich');
    expect((await list(editor.cookie)).body).toEqual(forbidden);
    expect((await create({ key: 'a', slug: 'a', label: 'A' }, editor.cookie)).status).toBe(403);
    expect((await action(id, 'archive', editor.cookie)).status).toBe(403);
    expect((await remove(id, editor.cookie)).status).toBe(403);
    expect((await server().get('/admin/post-categories')).status).toBe(401);
    const noHeader = await server()
      .post('/admin/post-categories')
      .set('Cookie', admin.cookie)
      .send({ key: 'b', slug: 'b', label: 'B' });
    expect(noHeader.status).toBe(403);
  });

  it.each([
    ['a NUL in the label', { key: 'a', slug: 'a', label: 'a\u0000' }, 'label', 'INVALID'],
    ['a lone surrogate', { key: 'a', slug: 'a', label: 'a\ud800' }, 'label', 'INVALID'],
    ['an upper-case slug', { key: 'a', slug: 'Du-Lich', label: 'A' }, 'slug', 'INVALID_FORMAT'],
    ['an upper-case key', { key: 'Du', slug: 'du', label: 'A' }, 'key', 'INVALID_FORMAT'],
    ['a blank label', { key: 'a', slug: 'a', label: '   ' }, 'label', 'TOO_SHORT'],
    ['a 61-character label', { key: 'a', slug: 'a', label: 'x'.repeat(61) }, 'label', 'TOO_LONG'],
  ])('rejects %s with 400', async (_name, input, field, code) => {
    const res = await create(input);
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields).toEqual([expect.objectContaining({ field, code })]);
  });

  it('answers 400 for a malformed id', async () => {
    const res = await remove('nope');
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields[0]).toMatchObject({
      field: 'categoryId',
      code: 'INVALID_FORMAT',
    });
  });
});
