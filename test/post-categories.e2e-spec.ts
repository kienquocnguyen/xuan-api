import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { signInAs, type TestUser, XHR } from './support/auth.js';
import { insertCategory, type TestCategory } from './support/categories.js';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const notFound = {
  data: null,
  error: { code: 'NOT_FOUND', message: 'The requested resource was not found.', details: {} },
};
const body = (t: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
});

describe('Public categories, filter and related posts (blog completion B2)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let editor: { user: TestUser; cookie: string };
  let travel: TestCategory;
  let food: TestCategory;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    editor = await signInAs(app, { role: 'editor' });
    travel = await insertCategory(app, { key: 'du-lich', label: 'Du lịch' });
    food = await insertCategory(app, { key: 'am-thuc', label: 'Ẩm thực' });
  });
  afterAll(async () => {
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  /** Creates a post through the API in a category; publishes it unless `draft`. */
  const post = async (slug: string, category: TestCategory, { draft = false } = {}) => {
    const created = await server()
      .post('/admin/posts')
      .set(XHR)
      .set('Cookie', editor.cookie)
      .send({ slug, title: `Bài ${slug}`, body: body(slug), categoryId: category.id });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    if (!draft) {
      const published = await server()
        .post(`/admin/posts/${id}/publish`)
        .set(XHR)
        .set('Cookie', editor.cookie);
      expect(published.status).toBe(200);
    }
    return id;
  };
  const slugsOf = (res: { body: { data: { items?: { slug: string }[] } | { slug: string }[] } }) =>
    (Array.isArray(res.body.data) ? res.body.data : (res.body.data.items ?? [])).map(
      (item) => item.slug,
    );

  describe('GET /post-categories', () => {
    it('lists active categories in Vietnamese order with published counts, zero included', async () => {
      await post('mot', travel);
      await post('hai', travel);
      await post('nhap', travel, { draft: true });
      const archivedPost = await post('cu', food);
      await server()
        .post(`/admin/posts/${archivedPost}/archive`)
        .set(XHR)
        .set('Cookie', editor.cookie);
      const retired = await insertCategory(app, { key: 'bo', label: 'Bỏ' });
      await db.query(`UPDATE content_categories SET status = 'archived' WHERE id = $1`, [
        retired.id,
      ]);

      const res = await server().get('/post-categories');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: [
          { slug: 'am-thuc', label: 'Ẩm thực', publishedPostCount: 0 },
          { slug: 'du-lich', label: 'Du lịch', publishedPostCount: 2 },
        ],
      });
    });
  });

  describe('GET /posts?category=', () => {
    it('filters by category and counts only its published posts (Review Focus 3)', async () => {
      await post('a', travel);
      await post('b', food);
      await post('c', travel);
      await post('d', travel);
      await post('e', travel, { draft: true });
      const res = await server().get('/posts?category=du-lich&page=1&pageSize=2');
      expect(res.status).toBe(200);
      expect(slugsOf(res)).toEqual(['d', 'c']);
      expect(res.body.data.pageInfo).toEqual({
        page: 1,
        pageSize: 2,
        totalItems: 3,
        totalPages: 2,
      });
      expect(res.body.data.items[0].category).toEqual({ slug: 'du-lich', label: 'Du lịch' });
    });

    it('answers 404 for an unknown or archived category and 400 for a malformed one', async () => {
      expect((await server().get('/posts?category=khong-co')).body).toEqual(notFound);
      await db.query(`UPDATE content_categories SET status = 'archived' WHERE id = $1`, [food.id]);
      expect((await server().get('/posts?category=am-thuc')).status).toBe(404);
      const malformed = await server().get('/posts?category=Du-Lich');
      expect(malformed.status).toBe(400);
      expect(malformed.body.error.details.fields[0]).toMatchObject({
        field: 'category',
        code: 'INVALID_FORMAT',
      });
    });

    it('keeps a legacy published post without a category in the unfiltered list (Review Focus 2)', async () => {
      const id = await post('cu', travel, { draft: true });
      await db.query(
        `UPDATE content_posts SET category_id = NULL, status = 'published', published_at = now() WHERE id = $1`,
        [id],
      );
      const all = await server().get('/posts');
      expect(all.body.data.items).toEqual([
        expect.objectContaining({ slug: 'cu', category: null }),
      ]);
      expect(slugsOf(await server().get('/posts?category=du-lich'))).toEqual([]);
      expect((await server().get('/posts/cu')).body.data.category).toBeNull();
    });
  });

  it('shows no category on public reads once it is archived (final review)', async () => {
    await post('a', travel);
    await post('b', travel);
    await db.query(`UPDATE content_categories SET status = 'archived' WHERE id = $1`, [travel.id]);
    expect(
      (await server().get('/posts')).body.data.items.map((i: { category: unknown }) => i.category),
    ).toEqual([null, null]);
    expect((await server().get('/posts/a')).body.data.category).toBeNull();
    expect((await server().get('/posts/a/related')).body.data).toEqual([
      expect.objectContaining({ slug: 'b', category: null }),
    ]);
  });

  describe('GET /posts/:slug/related', () => {
    it('prefers the same category, never pads it with others when it has enough (Review Focus 4)', async () => {
      await post('f1', food);
      await post('t1', travel);
      await post('t2', travel);
      await post('t3', travel);
      await post('t4', travel);
      const res = await server().get('/posts/t1/related');
      expect(res.status).toBe(200);
      expect(slugsOf(res)).toEqual(['t4', 't3', 't2']);
    });

    it('pads with the newest others, skipping drafts and the post itself', async () => {
      await post('t1', travel);
      await post('f1', food);
      await post('t2', travel);
      await post('f2', food);
      await post('t3', travel, { draft: true });
      expect(slugsOf(await server().get('/posts/t1/related'))).toEqual(['t2', 'f2', 'f1']);
    });

    it('gives a post without a category the newest others', async () => {
      await post('f1', food);
      const legacy = await post('cu', travel, { draft: true });
      await db.query(
        `UPDATE content_posts SET category_id = NULL, status = 'published', published_at = now() WHERE id = $1`,
        [legacy],
      );
      await post('f2', food);
      expect(slugsOf(await server().get('/posts/cu/related'))).toEqual(['f2', 'f1']);
    });

    it('answers 404 for a draft or unknown post', async () => {
      await post('nhap', travel, { draft: true });
      expect((await server().get('/posts/nhap/related')).body).toEqual(notFound);
      expect((await server().get('/posts/khong-co/related')).status).toBe(404);
    });
  });
});
