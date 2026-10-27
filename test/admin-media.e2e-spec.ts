import { existsSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { APP_CONFIG } from '../src/config/app-config.module.js';
import type { AppConfig } from '../src/config/load-config.js';
import { signInAs, type TestUser, XHR } from './support/auth.js';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#2a6' } });
const invalidFile = {
  data: null,
  error: {
    code: 'VALIDATION_FAILED',
    message: 'The request is invalid.',
    details: { fields: [{ field: 'file', code: 'INVALID', message: 'This value is invalid.' }] },
  },
};

describe('Uploading images (POST /admin/media/images, blog completion B3)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let config: AppConfig;
  let editor: { user: TestUser; cookie: string };

  const storedFiles = async () =>
    existsSync(join(config.media.localDir as string, 'blog'))
      ? (await readdir(join(config.media.localDir as string, 'blog'))).sort()
      : [];

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    config = app.get<AppConfig>(APP_CONFIG);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    await rm(config.media.localDir as string, { recursive: true, force: true });
    editor = await signInAs(app, { role: 'editor' });
  });
  afterAll(async () => {
    await app.close();
  });

  const upload = (file: Buffer | null, cookie = editor.cookie, name = 'photo.jpg') => {
    const req = request(app.getHttpServer())
      .post('/admin/media/images')
      .set(XHR)
      .set('Cookie', cookie);
    return file ? req.attach('file', file, name) : req.field('note', 'x');
  };

  it('stores WebP variants and answers with their URLs', async () => {
    const res = await upload(await solid(2400, 1600).jpeg().toBuffer());
    expect(res.status).toBe(201);
    const [row] = await db.query<{ id: string; storage_key: string; uploader_id: string }[]>(
      'SELECT id, storage_key, uploader_id FROM content_media',
    );
    const base = `${config.media.publicBaseUrl}/${row.storage_key}`;
    expect(res.body).toEqual({
      data: {
        id: row.id,
        url: `${base}-1280.webp`,
        width: 1280,
        height: 853,
        variants: [
          { width: 640, height: 427, url: `${base}-640.webp` },
          { width: 1280, height: 853, url: `${base}-1280.webp` },
          { width: 1920, height: 1280, url: `${base}-1920.webp` },
        ],
      },
    });
    expect(row.uploader_id).toBe(editor.user.id);
    expect(row.storage_key).toMatch(/^blog\/[0-9a-f-]{36}$/);
    expect(res.text).not.toContain('photo');
    const files = await storedFiles();
    expect(files).toHaveLength(3);
    const stored = await readFile(
      join(config.media.localDir as string, `${row.storage_key}-640.webp`),
    );
    expect((await sharp(stored).metadata()).format).toBe('webp');
  });

  it('keeps a narrow image at its own width', async () => {
    const res = await upload(await solid(500, 300).png().toBuffer(), editor.cookie, 'a.png');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ width: 500, height: 300 });
    expect(res.body.data.variants).toHaveLength(1);
  });

  it('removes GPS and applies the orientation (Review Focus 1)', async () => {
    const jpeg = await solid(800, 400)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExif({ IFD3: { GPSLatitudeRef: 'N' } })
      .toBuffer();
    const res = await upload(jpeg);
    expect(res.body.data).toMatchObject({ width: 400, height: 800 });
    const [{ storage_key }] = await db.query<{ storage_key: string }[]>(
      'SELECT storage_key FROM content_media',
    );
    const stored = await readFile(join(config.media.localDir as string, `${storage_key}-400.webp`));
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
  });

  it.each([
    ['a renamed text file', async () => Buffer.from('hello'), 'photo.jpg'],
    [
      'a sized SVG',
      async () =>
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="red"/></svg>',
        ),
      'a.svg',
    ],
    ['a real GIF', () => solid(700, 500).gif().toBuffer(), 'a.gif'],
    ['a TIFF', () => solid(700, 500).tiff().toBuffer(), 'a.tif'],
    [
      'an animated WebP',
      async () => {
        const frame = (c: string) =>
          sharp({ create: { width: 10, height: 10, channels: 4, background: c } })
            .png()
            .toBuffer();
        return sharp([await frame('#f00'), await frame('#0f0')], { join: { animated: true } })
          .webp({ loop: 0 })
          .toBuffer();
      },
      'a.webp',
    ],
    ['a 7000-pixel-wide PNG', () => solid(7000, 10).png().toBuffer(), 'big.png'],
  ])('rejects %s with 400 and writes nothing (Review Focus 2)', async (_name, make, filename) => {
    const res = await upload(await make(), editor.cookie, filename);
    expect(res.status).toBe(400);
    expect(res.body).toEqual(invalidFile);
    expect(await storedFiles()).toEqual([]);
    expect(await db.query('SELECT 1 FROM content_media')).toEqual([]);
  });

  it('answers every upload of a concurrent burst predictably (bounded pipelines)', async () => {
    const valid = await Promise.all(
      [700, 800, 900, 1000, 1100].map((width) => solid(width, 600).jpeg().toBuffer()),
    );
    const responses = await Promise.all([
      ...valid.map((file) => upload(file)),
      upload(Buffer.from('hello'), editor.cookie, 'a.jpg'),
      upload(await solid(7000, 10).png().toBuffer(), editor.cookie, 'big.png'),
    ]);
    expect(responses.map((res) => res.status)).toEqual([201, 201, 201, 201, 201, 400, 400]);
    expect(responses.slice(5).map((res) => res.body)).toEqual([invalidFile, invalidFile]);
    const ids = new Set(responses.slice(0, 5).map((res) => res.body.data.id as string));
    expect(ids.size).toBe(5);
    expect(await db.query('SELECT 1 FROM content_media')).toHaveLength(5);
    expect(await storedFiles()).toHaveLength(5); // one 640 variant each
  });

  it('answers 413 above 12 MiB', async () => {
    const res = await upload(Buffer.alloc(12 * 1024 * 1024 + 1, 0xff));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('requires the file part and refuses any other part', async () => {
    const none = await upload(null);
    expect(none.status).toBe(400);
    expect(none.body.error.details.fields).toEqual(
      expect.arrayContaining([
        { field: 'file', code: 'REQUIRED', message: 'This field is required.' },
      ]),
    );
    const extra = await request(app.getHttpServer())
      .post('/admin/media/images')
      .set(XHR)
      .set('Cookie', editor.cookie)
      .field('title', 'x')
      .attach('file', await solid(10, 10).png().toBuffer(), 'a.png');
    expect(extra.status).toBe(400);
    expect(extra.body.error.details.fields).toEqual([
      { field: 'title', code: 'UNKNOWN_FIELD', message: 'This field is not allowed.' },
    ]);
    const wrongName = await request(app.getHttpServer())
      .post('/admin/media/images')
      .set(XHR)
      .set('Cookie', editor.cookie)
      .attach('image', await solid(10, 10).png().toBuffer(), 'a.png');
    expect(wrongName.body.error.details.fields).toEqual([
      { field: 'image', code: 'UNKNOWN_FIELD', message: 'This field is not allowed.' },
    ]);
  });

  it('lets editors and admins upload; users 403, guests 401, no CSRF header 403', async () => {
    const png = await solid(10, 10).png().toBuffer();
    const admin = await signInAs(app, { role: 'admin' });
    expect((await upload(png, admin.cookie)).status).toBe(201);
    const user = await signInAs(app, { role: 'user' });
    expect((await upload(png, user.cookie)).status).toBe(403);
    const guest = await request(app.getHttpServer())
      .post('/admin/media/images')
      .set(XHR)
      .attach('file', png, 'a.png');
    expect(guest.status).toBe(401);
    const noHeader = await request(app.getHttpServer())
      .post('/admin/media/images')
      .set('Cookie', editor.cookie)
      .attach('file', png, 'a.png');
    expect(noHeader.status).toBe(403);
  });

  describe('with MEDIA_STORAGE=disabled (owner Q1)', () => {
    let disabled: NestExpressApplication;
    beforeAll(async () => {
      disabled = await createTestApp([], {
        media: { storage: 'disabled', publicBaseUrl: null, localDir: null, r2: null },
      });
    });
    afterAll(async () => {
      await disabled.close();
    });

    it('answers 409 MEDIA_STORAGE_DISABLED and writes nothing; other routes keep working', async () => {
      const res = await request(disabled.getHttpServer())
        .post('/admin/media/images')
        .set(XHR)
        .set('Cookie', editor.cookie)
        .attach('file', await solid(10, 10).png().toBuffer(), 'a.png');
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        data: null,
        error: {
          code: 'MEDIA_STORAGE_DISABLED',
          message: 'Image uploads are switched off on this server.',
          details: {},
        },
      });
      expect(await db.query('SELECT 1 FROM content_media')).toEqual([]);
      expect((await request(disabled.getHttpServer()).get('/posts')).status).toBe(200);
      expect((await request(disabled.getHttpServer()).get('/media/x.webp')).status).toBe(404);
    });
  });
});
