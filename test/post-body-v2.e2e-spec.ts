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

const envelope = (code: string, message: string, details: object = {}) => ({
  data: null,
  error: { code, message, details },
});
const unsupported = envelope(
  'POST_BODY_VERSION_UNSUPPORTED',
  'This post needs an editor that supports body version 2.',
);
const mediaMissing = envelope('POST_MEDIA_NOT_FOUND', "The chosen image doesn't exist.");
const incomplete = envelope('POST_MEDIA_INCOMPLETE', 'Finish the before/after images first.');
const invalidAt = (field: string) =>
  envelope('VALIDATION_FAILED', 'The request is invalid.', {
    fields: [{ field, code: 'INVALID', message: 'This value is invalid.' }],
  });

const p = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const doc = (...content: unknown[]) => ({ type: 'doc', content });

describe('Body version 2 and its contract (blog completion B3, spec §3.4, §5.5)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let config: AppConfig;
  let editor: { user: TestUser; cookie: string };
  let category: TestCategory;
  let src: string;
  let key: string;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    config = app.get<AppConfig>(APP_CONFIG);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    editor = await signInAs(app, { role: 'editor' });
    category = await insertCategory(app);
    key = `blog/${randomUUID()}`;
    await db.query(
      `INSERT INTO content_media (uploader_id, storage_key, width, height, variant_widths, byte_size) VALUES ($1, $2, 1280, 720, '{640,1280}', 100)`,
      [editor.user.id, key],
    );
    src = `${config.media.publicBaseUrl}/${key}-1280.webp`;
  });
  afterAll(async () => {
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const image = (source = src) => ({
    type: 'image',
    attrs: { src: source, alt: 'Ảnh', title: null, width: 1280, height: 720 },
  });
  const beforeAfter = (after = src) => ({
    type: 'beforeAfter',
    attrs: {
      before: src,
      after,
      beforeAlt: 'Trước',
      afterAlt: 'Sau',
      caption: '',
      initial: 50,
      width: 1280,
      height: 720,
    },
  });
  const save = (body: unknown, extra: Record<string, unknown> = {}) => ({
    slug: 'bai-viet',
    title: 'Bài viết',
    body,
    categoryId: category.id,
    ...extra,
  });
  const create = (input: object) =>
    server().post('/admin/posts').set(XHR).set('Cookie', editor.cookie).send(input);
  const update = (id: string, input: object) =>
    server().put(`/admin/posts/${id}`).set(XHR).set('Cookie', editor.cookie).send(input);
  const publish = (id: string) =>
    server().post(`/admin/posts/${id}/publish`).set(XHR).set('Cookie', editor.cookie);

  it('stores a body with library images as version 2', async () => {
    const res = await create(save(doc(p('Xin chào'), image()), { bodyVersion: 2 }));
    expect(res.status).toBe(201);
    expect(res.body.data.bodyVersion).toBe(2);
    expect(res.body.data.body).toEqual(doc(p('Xin chào'), image()));
  });

  it('stores a text-only body as version 1 even when the client declares 2', async () => {
    const res = await create(save(doc(p('Chỉ chữ')), { bodyVersion: 2 }));
    expect(res.body.data.bodyVersion).toBe(1);
  });

  it('refuses version 2 nodes from a client that declares version 1 (or nothing)', async () => {
    const res = await create(save(doc(p('a'), image())));
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields[0].field).toMatch(/^body\.content\.1/);
  });

  it('refuses the current web save shape on a version 2 post, writing nothing (Review Focus 3)', async () => {
    const created = await create(save(doc(p('a'), image()), { bodyVersion: 2 }));
    const id = created.body.data.id as string;
    const res = await update(id, {
      slug: 'bai-viet',
      title: 'Sửa bằng trình soạn cũ',
      excerpt: '',
      seoTitle: '',
      seoDescription: '',
      categoryId: category.id,
      body: doc(p('a')),
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual(unsupported);
    const [row] = await db.query<{ title: string; body_version: number }[]>(
      'SELECT title, body_version FROM content_posts WHERE id = $1',
      [id],
    );
    expect(row).toEqual({ title: 'Bài viết', body_version: 2 });
  });

  it('lets a version 2 client save a version 2 post down to text, stored as version 1', async () => {
    const created = await create(save(doc(p('a'), image()), { bodyVersion: 2 }));
    const res = await update(created.body.data.id, save(doc(p('chỉ chữ')), { bodyVersion: 2 }));
    expect(res.status).toBe(200);
    expect(res.body.data.bodyVersion).toBe(1);
  });

  it.each([
    ['another host', () => src.replace('http://localhost', 'http://evil')],
    ['another path', () => `${config.media.publicBaseUrl}/../x-640.webp`],
    ['a PNG name', () => `${config.media.publicBaseUrl}/${key}-640.png`],
  ])('rejects an image from %s at its attribute (Review Focus 4)', async (_name, make) => {
    const res = await create(save(doc(image(make())), { bodyVersion: 2 }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual(invalidAt('body.content.0.attrs.src'));
  });

  it.each([
    ['an unknown key', () => `${config.media.publicBaseUrl}/blog/${randomUUID()}-640.webp`],
    ['a width the media lacks', () => `${config.media.publicBaseUrl}/${key}-1920.webp`],
  ])('answers 409 POST_MEDIA_NOT_FOUND for %s', async (_name, make) => {
    const res = await create(save(doc(image(make())), { bodyVersion: 2 }));
    expect(res.status).toBe(409);
    expect(res.body).toEqual(mediaMissing);
  });

  it('keeps an unfinished before/after block in drafts only', async () => {
    const created = await create(save(doc(p('a'), beforeAfter('')), { bodyVersion: 2 }));
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const res = await publish(id);
    expect(res.status).toBe(409);
    expect(res.body).toEqual(incomplete);

    await update(id, save(doc(p('a'), beforeAfter()), { bodyVersion: 2 }));
    expect((await publish(id)).status).toBe(200);
    const broken = await update(id, save(doc(p('a'), beforeAfter('')), { bodyVersion: 2 }));
    expect(broken.status).toBe(409);
    expect(broken.body).toEqual(incomplete);
  });

  it('accepts an unknown bodyVersion only as 1 or 2', async () => {
    const res = await create(save(doc(p('a')), { bodyVersion: 3 }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields[0].field).toBe('bodyVersion');
  });
});
