import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { signInAs, type TestUser, XHR } from './support/auth.js';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const notFound = {
  data: null,
  error: { code: 'NOT_FOUND', message: 'The requested resource was not found.', details: {} },
};
const body = (t: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
});

describe('Public posts (/posts)', () => {
  let app: NestExpressApplication;
  let editor: { user: TestUser; cookie: string };

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    editor = await signInAs(app, {
      role: 'editor',
      displayName: 'Xuân',
      avatarUrl: 'https://lh3.googleusercontent.com/a/x',
      email: 'xuan@example.com',
    });
  });
  afterAll(async () => {
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  /** Creates a post through the API; publishes it unless `draft`. */
  const post = async (
    slug: string,
    { draft = false, excerpt }: { draft?: boolean; excerpt?: string } = {},
  ) => {
    const created = await server()
      .post('/admin/posts')
      .set(XHR)
      .set('Cookie', editor.cookie)
      .send({
        slug,
        title: `Tiêu đề ${slug}`,
        body: body(`Nội dung ${slug}`),
        excerpt,
        seoTitle: `SEO ${slug}`,
      });
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
  const unpublish = (id: string) =>
    server().post(`/admin/posts/${id}/unpublish`).set(XHR).set('Cookie', editor.cookie);

  it('hides archived posts, including ever-published ones (blog completion B1)', async () => {
    const id = await post('luu-tru');
    const archived = await server()
      .post(`/admin/posts/${id}/archive`)
      .set(XHR)
      .set('Cookie', editor.cookie);
    expect(archived.status).toBe(200);
    expect((await server().get('/posts')).body.data.items).toEqual([]);
    const read = await server().get('/posts/luu-tru');
    expect(read.status).toBe(404);
    expect(read.body).toEqual(notFound);
  });

  describe('GET /posts', () => {
    it('lists only published posts, newest first, without author ids or emails', async () => {
      const older = await post('cu', { excerpt: 'Tóm tắt' });
      await post('nhap', { draft: true });
      const newer = await post('moi');

      const res = await server().get('/posts');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: {
          items: [
            {
              id: newer,
              slug: 'moi',
              title: 'Tiêu đề moi',
              excerpt: null,
              publishedAt: expect.stringMatching(ISO),
              author: { displayName: 'Xuân', avatarUrl: 'https://lh3.googleusercontent.com/a/x' },
            },
            {
              id: older,
              slug: 'cu',
              title: 'Tiêu đề cu',
              excerpt: 'Tóm tắt',
              publishedAt: expect.stringMatching(ISO),
              author: { displayName: 'Xuân', avatarUrl: 'https://lh3.googleusercontent.com/a/x' },
            },
          ],
          pageInfo: { page: 1, pageSize: 12, totalItems: 2, totalPages: 1 },
        },
      });
      expect(JSON.stringify(res.body)).not.toContain('xuan@example.com');
      expect(JSON.stringify(res.body)).not.toContain(editor.user.id);
    });

    it('paginates, and a page beyond the last is empty', async () => {
      await post('mot');
      await post('hai');
      const second = await server().get('/posts?page=2&pageSize=1');
      expect(second.body.data.items).toHaveLength(1);
      expect(second.body.data.pageInfo).toEqual({
        page: 2,
        pageSize: 1,
        totalItems: 2,
        totalPages: 2,
      });
      const beyond = await server().get('/posts?page=9');
      expect(beyond.status).toBe(200);
      expect(beyond.body.data).toEqual({
        items: [],
        pageInfo: { page: 9, pageSize: 12, totalItems: 2, totalPages: 1 },
      });
    });

    it.each(['page=0', 'pageSize=0', 'pageSize=51', 'page=abc', 'foo=1'])(
      'rejects ?%s with 400',
      async (query) => {
        const res = await server().get(`/posts?${query}`);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      },
    );
  });

  describe('GET /posts/:slug', () => {
    it('returns a published post', async () => {
      const id = await post('bai-viet');
      const res = await server().get('/posts/bai-viet');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: {
          id,
          slug: 'bai-viet',
          title: 'Tiêu đề bai-viet',
          excerpt: null,
          publishedAt: expect.stringMatching(ISO),
          author: { displayName: 'Xuân', avatarUrl: 'https://lh3.googleusercontent.com/a/x' },
          language: 'vi',
          body: body('Nội dung bai-viet'),
          bodyVersion: 1,
          seoTitle: 'SEO bai-viet',
          seoDescription: null,
          updatedAt: expect.stringMatching(ISO),
        },
      });
    });

    it.each(['nhap', 'khong-co', 'UPPER', '%00', 'a'.repeat(200)])(
      'answers 404 for %s',
      async (slug) => {
        await post('nhap', { draft: true });
        const res = await server().get(`/posts/${slug}`);
        expect(res.status).toBe(404);
        expect(res.body).toEqual(notFound);
      },
    );

    it('hides a post again once it is unpublished', async () => {
      const id = await post('tam-thoi');
      await unpublish(id);
      expect((await server().get('/posts/tam-thoi')).status).toBe(404);
      expect((await server().get('/posts')).body.data.items).toEqual([]);
    });
  });
});
