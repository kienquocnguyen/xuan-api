import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { APP_CONFIG } from '../src/config/app-config.module.js';
import type { AppConfig } from '../src/config/load-config.js';
import { signInAs, type TestUser, XHR } from './support/auth.js';
import { insertCategory, type TestCategory } from './support/categories.js';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

/**
 * B3 pre-deployment fix: switching a server from r2 to `MEDIA_STORAGE=disabled` must not let a save silently
 * erase the media a post already references. Uploads stop; reading keeps working (with a base URL), and the
 * admin DTO always carries the raw references the form sends back.
 */
describe('Post media while uploads are disabled (B3 pre-deployment fix)', () => {
  let app: NestExpressApplication;
  let reading: NestExpressApplication; // disabled, with MEDIA_PUBLIC_BASE_URL kept
  let blind: NestExpressApplication; // disabled, no base URL at all
  let db: DataSource;
  let base: string;
  let editor: { user: TestUser; cookie: string };
  let category: TestCategory;
  let cover: { id: string; key: string };
  let og: { id: string; key: string };

  const text = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
  };
  const withImage = (src: string) => ({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
      { type: 'image', attrs: { src, alt: 'Ảnh', title: null, width: 640, height: 360 } },
    ],
  });
  const url = (key: string, width: number) => `${base}/${key}-${width}.webp`;
  const insertMedia = async (width: number, height: number, widths: number[]) => {
    const key = `blog/${randomUUID()}`;
    const [{ id }] = await db.query<{ id: string }[]>(
      `INSERT INTO content_media (uploader_id, storage_key, width, height, variant_widths, byte_size) VALUES ($1, $2, $3, $4, $5, 100) RETURNING id`,
      [editor.user.id, key, width, height, widths],
    );
    return { id, key };
  };
  const save = (extra: Record<string, unknown> = {}) => ({
    slug: 'bai-viet',
    title: 'Bài viết',
    body: text,
    categoryId: category.id,
    tags: [],
    coverMediaId: cover.id,
    coverAlt: 'Ảnh bìa',
    ogMediaId: og.id,
    ...extra,
  });
  const on = (target: NestExpressApplication) => ({
    get: (path: string) => request(target.getHttpServer()).get(path).set('Cookie', editor.cookie),
    put: (path: string, input: object) =>
      request(target.getHttpServer()).put(path).set(XHR).set('Cookie', editor.cookie).send(input),
  });
  const stored = async (id: string) =>
    (
      await db.query<
        { cover_media_id: string | null; cover_alt: string | null; og_media_id: string | null }[]
      >('SELECT cover_media_id, cover_alt, og_media_id FROM content_posts WHERE id = $1', [id])
    )[0];
  const created = async (input: object) => {
    const res = await request(app.getHttpServer())
      .post('/admin/posts')
      .set(XHR)
      .set('Cookie', editor.cookie)
      .send(input);
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    base = app.get<AppConfig>(APP_CONFIG).media.publicBaseUrl as string;
    reading = await createTestApp([], {
      media: { storage: 'disabled', publicBaseUrl: base, localDir: null, r2: null },
    });
    blind = await createTestApp([], {
      media: { storage: 'disabled', publicBaseUrl: null, localDir: null, r2: null },
    });
  });
  beforeEach(async () => {
    await resetDatabase(app);
    editor = await signInAs(app, { role: 'editor' });
    category = await insertCategory(app);
    cover = await insertMedia(1280, 720, [640, 1280]);
    og = await insertMedia(640, 336, [640]);
  });
  afterAll(async () => {
    await Promise.all([app.close(), reading.close(), blind.close()]);
  });

  it('keeps showing stored images with a base URL, and a full save keeps them', async () => {
    const id = await created(save({ body: withImage(url(cover.key, 640)), bodyVersion: 2 }));
    const read = await on(reading).get(`/admin/posts/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.data).toMatchObject({
      coverMediaId: cover.id,
      coverAlt: 'Ảnh bìa',
      ogMediaId: og.id,
      coverImage: { mediaId: cover.id, url: url(cover.key, 1280), alt: 'Ảnh bìa' },
      ogImage: { mediaId: og.id, url: url(og.key, 640), alt: 'Ảnh bìa' },
    });
    const resaved = await on(reading).put(
      `/admin/posts/${id}`,
      save({ body: withImage(url(cover.key, 640)), bodyVersion: 2, title: 'Sửa' }),
    );
    expect(resaved.status).toBe(200);
    expect(await stored(id)).toEqual({
      cover_media_id: cover.id,
      cover_alt: 'Ảnh bìa',
      og_media_id: og.id,
    });
    const upload = await request(reading.getHttpServer())
      .post('/admin/media/images')
      .set(XHR)
      .set('Cookie', editor.cookie)
      .attach('file', Buffer.from('x'), 'a.png');
    expect(upload.body.error.code).toBe('MEDIA_STORAGE_DISABLED');
  });

  it('without a base URL still hands the editor the references, so resaving them loses nothing', async () => {
    const id = await created(save());
    const read = await on(blind).get(`/admin/posts/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.data).toMatchObject({
      coverMediaId: cover.id,
      coverAlt: 'Ảnh bìa',
      ogMediaId: og.id,
      coverImage: null,
      ogImage: null,
    });
    const echoed = await on(blind).put(
      `/admin/posts/${id}`,
      save({
        title: 'Sửa',
        coverMediaId: read.body.data.coverMediaId,
        coverAlt: read.body.data.coverAlt,
        ogMediaId: read.body.data.ogMediaId,
      }),
    );
    expect(echoed.status).toBe(200);
    expect(await stored(id)).toEqual({
      cover_media_id: cover.id,
      cover_alt: 'Ảnh bìa',
      og_media_id: og.id,
    });
  });

  it('refuses rather than erases: an old save shape gets 409, a body image 400, the row unchanged', async () => {
    const id = await created(save());
    const { coverMediaId: _c, coverAlt: _a, ogMediaId: _o, ...oldShape } = save();
    const omitted = await on(blind).put(`/admin/posts/${id}`, oldShape);
    expect(omitted.status).toBe(409);
    expect(omitted.body.error).toEqual({
      code: 'POST_FIELDS_OMITTED',
      message: 'Send every field: the request leaves out fields that hold data.',
      details: { fields: ['coverMediaId', 'ogMediaId'] },
    });
    const imaged = await on(blind).put(
      `/admin/posts/${id}`,
      save({ body: withImage(url(cover.key, 640)), bodyVersion: 2 }),
    );
    expect(imaged.status).toBe(400);
    expect(imaged.body.error.details.fields).toEqual([
      { field: 'body.content.1.attrs.src', code: 'INVALID', message: 'This value is invalid.' },
    ]);
    expect(await stored(id)).toEqual({
      cover_media_id: cover.id,
      cover_alt: 'Ảnh bìa',
      og_media_id: og.id,
    });
  });
});
