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

const UNKNOWN_ID = '01900000-0000-7000-8000-000000000000';
const body = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
};
const fieldError = (field: string) => ({
  data: null,
  error: {
    code: 'VALIDATION_FAILED',
    message: 'The request is invalid.',
    details: { fields: [{ field, code: 'INVALID', message: 'This value is invalid.' }] },
  },
});

describe('Cover and OG images on posts (blog completion B3, spec §5.4)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let config: AppConfig;
  let editor: { user: TestUser; cookie: string };
  let category: TestCategory;
  let cover: { id: string; key: string };
  let og: { id: string; key: string };

  const insertMedia = async (width: number, height: number, widths: number[]) => {
    const key = `blog/${randomUUID()}`;
    const [{ id }] = await db.query<{ id: string }[]>(
      `INSERT INTO content_media (uploader_id, storage_key, width, height, variant_widths, byte_size) VALUES ($1, $2, $3, $4, $5, 100) RETURNING id`,
      [editor.user.id, key, width, height, widths],
    );
    return { id, key };
  };
  const url = (key: string, width: number) => `${config.media.publicBaseUrl}/${key}-${width}.webp`;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    config = app.get<AppConfig>(APP_CONFIG);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    editor = await signInAs(app, { role: 'editor' });
    category = await insertCategory(app);
    cover = await insertMedia(1920, 1080, [640, 1280, 1920]);
    og = await insertMedia(1200, 630, [640]);
  });
  afterAll(async () => {
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const save = (extra: Record<string, unknown> = {}) => ({
    slug: 'bai-viet',
    title: 'Bài viết',
    body,
    categoryId: category.id,
    tags: [],
    ...extra,
  });
  const create = (input: object) =>
    server().post('/admin/posts').set(XHR).set('Cookie', editor.cookie).send(input);
  const update = (id: string, input: object) =>
    server().put(`/admin/posts/${id}`).set(XHR).set('Cookie', editor.cookie).send(input);
  const coverImage = (alt: string) => ({
    url: url(cover.key, 1280),
    width: 1280,
    height: 720,
    alt,
    variants: [
      { width: 640, height: 360, url: url(cover.key, 640) },
      { width: 1280, height: 720, url: url(cover.key, 1280) },
      { width: 1920, height: 1080, url: url(cover.key, 1920) },
    ],
  });

  it('shows the cover and OG image to authors and readers', async () => {
    const created = await create(
      save({ coverMediaId: cover.id, coverAlt: '  Ảnh bìa ', ogMediaId: og.id }),
    );
    expect(created.status).toBe(201);
    expect(created.body.data.coverImage).toEqual({ mediaId: cover.id, ...coverImage('Ảnh bìa') });
    expect(created.body.data.ogImage).toEqual({
      mediaId: og.id,
      url: url(og.key, 640),
      width: 640,
      height: 336,
      alt: 'Ảnh bìa',
      variants: [{ width: 640, height: 336, url: url(og.key, 640) }],
    });

    const id = created.body.data.id as string;
    await server().post(`/admin/posts/${id}/publish`).set(XHR).set('Cookie', editor.cookie);
    const list = await server().get('/posts');
    expect(list.body.data.items[0].coverImage).toEqual(coverImage('Ảnh bìa'));
    const read = await server().get('/posts/bai-viet');
    expect(read.body.data.coverImage).toEqual(coverImage('Ảnh bìa'));
    expect(read.body.data.ogImage).toMatchObject({ url: url(og.key, 640), alt: 'Ảnh bìa' });
  });

  it('falls back to the title as the OG alt without a cover, and shows null when unset', async () => {
    const created = await create(save({ ogMediaId: og.id }));
    expect(created.body.data.coverImage).toBeNull();
    expect(created.body.data.ogImage.alt).toBe('Bài viết');
    const plain = await create(save({ slug: 'khong-anh' }));
    expect(plain.body.data).toMatchObject({ coverImage: null, ogImage: null });
  });

  it('requires alt text with a cover and refuses it without one', async () => {
    expect((await create(save({ coverMediaId: cover.id }))).body).toEqual(fieldError('coverAlt'));
    // One error per field: the pairing rule doesn't repeat a failed length check (final review).
    const blank = await create(save({ coverMediaId: cover.id, coverAlt: '   ' }));
    expect(blank.status).toBe(400);
    expect(blank.body.error.details.fields.map((f: { field: string }) => f.field)).toEqual([
      'coverAlt',
    ]);
    expect((await create(save({ coverAlt: 'Không có ảnh' }))).body).toEqual(fieldError('coverAlt'));
  });

  it('answers 409 POST_MEDIA_NOT_FOUND for unknown media', async () => {
    const res = await create(save({ ogMediaId: UNKNOWN_ID }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('POST_MEDIA_NOT_FOUND');
  });

  it('clears with null, and refuses the current web shape while a cover is set', async () => {
    const created = await create(
      save({ coverMediaId: cover.id, coverAlt: 'Bìa', ogMediaId: og.id }),
    );
    const id = created.body.data.id as string;
    const oldShape = await update(id, {
      slug: 'bai-viet',
      title: 'Mới',
      excerpt: '',
      seoTitle: '',
      seoDescription: '',
      body,
      categoryId: category.id,
      tags: [],
    });
    expect(oldShape.status).toBe(409);
    expect(oldShape.body.error).toEqual({
      code: 'POST_FIELDS_OMITTED',
      message: 'Send every field: the request leaves out fields that hold data.',
      details: { fields: ['coverMediaId', 'ogMediaId'] },
    });
    const cleared = await update(id, save({ coverMediaId: null, coverAlt: null, ogMediaId: null }));
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toMatchObject({ coverImage: null, ogImage: null });
  });
});
