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
const slugTaken = envelope('POST_SLUG_TAKEN', 'Another post already uses this slug.');
const slugLocked = envelope('POST_SLUG_LOCKED', 'A published post keeps its slug.');
const bodyEmpty = envelope('POST_BODY_EMPTY', 'A published post needs some content.');
const invalid = (field: string, code: string, message: string) =>
  envelope('VALIDATION_FAILED', 'The request is invalid.', { fields: [{ field, message, code }] });

const text = (t: string, marks?: unknown[]) => ({
  type: 'text',
  text: t,
  ...(marks ? { marks } : {}),
});
const p = (...content: unknown[]) =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const body = (t = 'Xin chào') => doc(p(text(t)));
const save = (overrides: Record<string, unknown> = {}) => ({
  slug: 'bai-viet',
  title: 'Bài viết',
  body: body(),
  ...overrides,
});

describe('Authoring posts (/admin/posts)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let admin: { user: TestUser; cookie: string };
  let editor: { user: TestUser; cookie: string };
  let otherEditor: { user: TestUser; cookie: string };

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    admin = await signInAs(app, { role: 'admin', displayName: 'Xuân' });
    editor = await signInAs(app, { role: 'editor', displayName: 'Biên tập' });
    otherEditor = await signInAs(app, { role: 'editor', displayName: 'Người khác' });
  });
  afterAll(async () => {
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const create = (input: object, cookie = editor.cookie) =>
    server().post('/admin/posts').set(XHR).set('Cookie', cookie).send(input);
  const update = (id: string, input: object, cookie = editor.cookie) =>
    server().put(`/admin/posts/${id}`).set(XHR).set('Cookie', cookie).send(input);
  const action = (id: string, verb: 'publish' | 'unpublish', cookie = editor.cookie) =>
    server().post(`/admin/posts/${id}/${verb}`).set(XHR).set('Cookie', cookie);
  const get = (id: string, cookie = editor.cookie) =>
    server().get(`/admin/posts/${id}`).set('Cookie', cookie);
  const createdId = async (input: object = save(), cookie = editor.cookie) => {
    const res = await create(input, cookie);
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };

  describe('POST /admin/posts', () => {
    it('creates a draft authored by the caller', async () => {
      const res = await create(
        save({ excerpt: '  Tóm tắt  ', seoTitle: 'SEO', seoDescription: '' }),
      );
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        data: {
          id: expect.any(String),
          slug: 'bai-viet',
          title: 'Bài viết',
          status: 'draft',
          publishedAt: null,
          updatedAt: expect.stringMatching(ISO),
          author: { id: editor.user.id, displayName: 'Biên tập', avatarUrl: null },
          language: 'vi',
          excerpt: 'Tóm tắt',
          body: body(),
          bodyVersion: 1,
          seoTitle: 'SEO',
          seoDescription: null,
          createdAt: expect.stringMatching(ISO),
        },
      });
    });

    it('rejects a duplicate slug with 409 POST_SLUG_TAKEN', async () => {
      await createdId();
      const res = await create(save({ title: 'Khác' }), otherEditor.cookie);
      expect(res.status).toBe(409);
      expect(res.body).toEqual(slugTaken);
    });

    it.each([
      [
        'an upper-case slug',
        save({ slug: 'Bai-Viet' }),
        'slug',
        'INVALID_FORMAT',
        'This value has an invalid format.',
      ],
      ['a blank title', save({ title: '   ' }), 'title', 'TOO_SHORT', 'This value is too short.'],
      [
        'a NUL in the title',
        save({ title: 'a\u0000b' }),
        'title',
        'INVALID',
        'This value is invalid.',
      ],
      [
        'a client-chosen author',
        save({ authorId: UNKNOWN_ID }),
        'authorId',
        'UNKNOWN_FIELD',
        'This field is not allowed.',
      ],
      [
        'a client-chosen status',
        save({ status: 'published' }),
        'status',
        'UNKNOWN_FIELD',
        'This field is not allowed.',
      ],
      [
        'an H1 in the body',
        save({ body: doc({ type: 'heading', attrs: { level: 1 } }) }),
        'body.content.0.attrs.level',
        'INVALID',
        'This value is invalid.',
      ],
      [
        'a javascript: link',
        save({
          body: doc(p(text('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))),
        }),
        'body.content.0.content.0.marks.0.attrs.href',
        'INVALID',
        'This value is invalid.',
      ],
    ])('rejects %s with 400', async (_name, input, field, code, message) => {
      const res = await create(input);
      expect(res.status).toBe(400);
      expect(res.body).toEqual(invalid(field, code, message));
    });

    it('rejects a 10 000-level document with 400, never 500', async () => {
      let node: object = { type: 'paragraph' };
      for (let i = 0; i < 10_000; i++) node = { type: 'blockquote', content: [node] };
      const res = await create(save({ body: doc(node) }));
      expect(res.status).toBe(400);
      expect(res.body).toEqual(invalid('body', 'INVALID', 'This value is invalid.'));
    });

    it('accepts a long article above the 100 kB global limit', async () => {
      // ~210 kB of UTF-8: above the global 100 kB parser limit, below the 256 KiB body limit
      const paragraphs = Array.from({ length: 180 }, (_, i) =>
        p(text(`Đoạn ${i} ${'nội dung '.repeat(100)}`)),
      );
      const bytes = Buffer.byteLength(JSON.stringify(save({ body: doc(...paragraphs) })), 'utf8');
      expect(bytes).toBeGreaterThan(150_000);
      expect(bytes).toBeLessThan(256 * 1024);
      const res = await create(save({ body: doc(...paragraphs) }));
      expect(res.status).toBe(201);
    });

    it('stores TipTap default link attributes canonically', async () => {
      const tiptap = {
        type: 'link',
        attrs: {
          href: 'https://x.vn',
          target: '_blank',
          rel: 'noopener noreferrer nofollow',
          class: null,
          title: null,
        },
      };
      const id = await createdId(save({ body: doc(p(text('a', [tiptap]))) }));
      const res = await get(id);
      expect(res.body.data.body).toEqual(
        doc(p(text('a', [{ type: 'link', attrs: { href: 'https://x.vn' } }]))),
      );
    });

    it('needs the CSRF header, a session and an authoring role', async () => {
      const noHeader = await server()
        .post('/admin/posts')
        .set('Cookie', editor.cookie)
        .send(save());
      expect(noHeader.status).toBe(403);
      const guest = await server().post('/admin/posts').set(XHR).send(save());
      expect(guest.status).toBe(401);
      const user = await signInAs(app, { role: 'user' });
      const asUser = await create(save(), user.cookie);
      expect(asUser.status).toBe(403);
      expect(asUser.body).toEqual(forbidden);
    });
  });

  describe('ownership', () => {
    it('lets other editors neither read nor change a post; admins can', async () => {
      const id = await createdId();
      for (const res of [
        await get(id, otherEditor.cookie),
        await update(id, save(), otherEditor.cookie),
        await action(id, 'publish', otherEditor.cookie),
        await action(id, 'unpublish', otherEditor.cookie),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body).toEqual(forbidden);
      }
      expect((await get(id, admin.cookie)).status).toBe(200);
      expect((await update(id, save({ title: 'Admin sửa' }), admin.cookie)).body.data.title).toBe(
        'Admin sửa',
      );
    });

    it('answers 400 for a malformed id and 404 for an unknown one', async () => {
      const malformed = await get('not-a-uuid');
      expect(malformed.status).toBe(400);
      expect(malformed.body).toEqual(
        invalid('id', 'INVALID_FORMAT', 'This value has an invalid format.'),
      );
      for (const res of [
        await get(UNKNOWN_ID),
        await update(UNKNOWN_ID, save()),
        await action(UNKNOWN_ID, 'publish'),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(notFound);
      }
    });
  });

  describe('GET /admin/posts', () => {
    it('shows editors their own posts and admins every post, newest change first', async () => {
      const first = await createdId(save({ slug: 'mot' }));
      const second = await createdId(save({ slug: 'hai' }));
      await createdId(save({ slug: 'cua-nguoi-khac' }), otherEditor.cookie);

      const own = await server().get('/admin/posts').set('Cookie', editor.cookie);
      expect(own.status).toBe(200);
      expect(own.body.data.items.map((i: { id: string }) => i.id)).toEqual([second, first]);
      expect(own.body.data.items[0]).toEqual({
        id: second,
        slug: 'hai',
        title: 'Bài viết',
        status: 'draft',
        publishedAt: null,
        updatedAt: expect.stringMatching(ISO),
        author: { id: editor.user.id, displayName: 'Biên tập', avatarUrl: null },
      });
      expect(own.body.data.pageInfo).toEqual({
        page: 1,
        pageSize: 12,
        totalItems: 2,
        totalPages: 1,
      });

      const all = await server().get('/admin/posts').set('Cookie', admin.cookie);
      expect(all.body.data.pageInfo.totalItems).toBe(3);
    });

    it('filters by status and paginates', async () => {
      const published = await createdId(save({ slug: 'da-dang' }));
      await action(published, 'publish');
      await createdId(save({ slug: 'nhap' }));
      const res = await server().get('/admin/posts?status=published').set('Cookie', editor.cookie);
      expect(res.body.data.items.map((i: { id: string }) => i.id)).toEqual([published]);
      const page = await server()
        .get('/admin/posts?page=2&pageSize=1')
        .set('Cookie', editor.cookie);
      expect(page.body.data.pageInfo).toEqual({
        page: 2,
        pageSize: 1,
        totalItems: 2,
        totalPages: 2,
      });
    });

    it.each(['status=archived', 'pageSize=51', 'page=0', 'foo=1'])(
      'rejects ?%s with 400',
      async (query) => {
        const res = await server().get(`/admin/posts?${query}`).set('Cookie', editor.cookie);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      },
    );
  });

  describe('PUT /admin/posts/:id', () => {
    it('replaces every editable field (omitted optional fields become null)', async () => {
      const id = await createdId(save({ excerpt: 'Tóm tắt', seoTitle: 'SEO' }));
      const res = await update(
        id,
        save({ title: 'Mới', body: body('Nội dung mới'), seoTitle: '   ' }),
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        title: 'Mới',
        excerpt: null,
        seoTitle: null,
        seoDescription: null,
        body: body('Nội dung mới'),
      });
    });

    it('lets a never-published draft change its slug', async () => {
      const id = await createdId();
      const res = await update(id, save({ slug: 'slug-moi' }));
      expect(res.status).toBe(200);
      expect(res.body.data.slug).toBe('slug-moi');
    });

    it('locks the slug once the post was published, also after unpublishing', async () => {
      const id = await createdId();
      await action(id, 'publish');
      const changed = await update(id, save({ slug: 'slug-moi' }));
      expect(changed.status).toBe(409);
      expect(changed.body).toEqual(slugLocked);
      expect((await update(id, save({ title: 'Sửa' }))).status).toBe(200); // same slug is fine
      await action(id, 'unpublish');
      expect((await update(id, save({ slug: 'slug-moi' }))).body).toEqual(slugLocked);
    });

    it('keeps a published post from becoming empty; drafts may be empty', async () => {
      const id = await createdId();
      await action(id, 'publish');
      const emptied = await update(id, save({ body: doc(p(text('   '))) }));
      expect(emptied.status).toBe(409);
      expect(emptied.body).toEqual(bodyEmpty);
      const draft = await createdId(save({ slug: 'nhap' }));
      expect((await update(draft, save({ slug: 'nhap', body: doc() }))).status).toBe(200);
    });

    it('rejects a slug another post already uses', async () => {
      await createdId(save({ slug: 'mot' }));
      const id = await createdId(save({ slug: 'hai' }));
      const res = await update(id, save({ slug: 'mot' }));
      expect(res.status).toBe(409);
      expect(res.body).toEqual(slugTaken);
    });
  });

  describe('concurrent update and publish (final review, Important 3)', () => {
    // Each outcome must match some serial order of the two requests (row lock, spec B17/B18).
    it('never changes the slug of a post after its publication', async () => {
      for (let trial = 0; trial < 15; trial++) {
        const id = await createdId(save({ slug: `goc-${trial}` }));
        const [updated, published] = await Promise.all([
          update(id, save({ slug: `moi-${trial}` })),
          action(id, 'publish'),
        ]);
        expect([200, 409]).toContain(updated.status);
        expect(published.status).toBe(200);
        const finalSlug = (await get(id)).body.data.slug as string;
        // Publish saw the old slug, so it ran first; then the slug change must have been refused.
        if (published.body.data.slug === `goc-${trial}`) expect(finalSlug).toBe(`goc-${trial}`);
      }
    });

    it('never ends with an empty published post', async () => {
      for (let trial = 0; trial < 15; trial++) {
        const id = await createdId(save({ slug: `rong-${trial}` }));
        await Promise.all([
          update(id, save({ slug: `rong-${trial}`, body: doc() })),
          action(id, 'publish'),
        ]);
        const final = (await get(id)).body.data as { status: string; body: unknown };
        if (final.status === 'published') expect(final.body).not.toEqual(doc());
      }
    });
  });

  describe('publish / unpublish', () => {
    it('sets publishedAt once and keeps it across unpublish and republish', async () => {
      const id = await createdId();
      const published = await action(id, 'publish');
      expect(published.status).toBe(200);
      expect(published.body.data.status).toBe('published');
      const firstPublishedAt = published.body.data.publishedAt as string;
      expect(firstPublishedAt).toMatch(ISO);

      const unpublished = await action(id, 'unpublish');
      expect(unpublished.body.data).toMatchObject({
        status: 'draft',
        publishedAt: firstPublishedAt,
      });
      const republished = await action(id, 'publish');
      expect(republished.body.data).toMatchObject({
        status: 'published',
        publishedAt: firstPublishedAt,
      });
    });

    it('is idempotent and does not touch updatedAt on a repeat', async () => {
      const id = await createdId();
      const once = await action(id, 'publish');
      const twice = await action(id, 'publish');
      expect(twice.status).toBe(200);
      expect(twice.body.data.updatedAt).toBe(once.body.data.updatedAt);
      const off = await action(id, 'unpublish');
      const offAgain = await action(id, 'unpublish');
      expect(offAgain.body.data.updatedAt).toBe(off.body.data.updatedAt);
    });

    it.each([
      ['an empty document', doc()],
      ['an empty paragraph', doc(p())],
      ['spaces and no-break spaces', doc(p(text('   ')))],
      ['only hard breaks', doc(p({ type: 'hardBreak' }))],
    ])('refuses to publish %s with 409 POST_BODY_EMPTY', async (_name, emptyBody) => {
      const id = await createdId(save({ body: emptyBody }));
      const res = await action(id, 'publish');
      expect(res.status).toBe(409);
      expect(res.body).toEqual(bodyEmpty);
      const [{ status }] = await db.query<{ status: string }[]>(
        'SELECT status FROM content_posts WHERE id = $1',
        [id],
      );
      expect(status).toBe('draft');
    });
  });
});
