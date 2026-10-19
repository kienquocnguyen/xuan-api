import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { signInAs, XHR } from './support/auth.js';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const notFound = {
  data: null,
  error: { code: 'NOT_FOUND', message: 'The requested resource was not found.', details: {} },
};

describe('Serving local media at /media (blog completion B3, development only)', () => {
  let app: NestExpressApplication;
  let path: string;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
    const editor = await signInAs(app, { role: 'editor' });
    const res = await request(app.getHttpServer())
      .post('/admin/media/images')
      .set(XHR)
      .set('Cookie', editor.cookie)
      .attach(
        'file',
        await sharp({ create: { width: 700, height: 350, channels: 3, background: '#36c' } })
          .png()
          .toBuffer(),
        'a.png',
      );
    expect(res.status).toBe(201);
    path = new URL(res.body.data.variants[0].url).pathname;
    expect(app.get(DataSource)).toBeDefined();
  });
  afterAll(async () => {
    await app.close();
  });

  it('serves an uploaded variant across origins, without sniffing, cached forever', async () => {
    const res = await request(app.getHttpServer()).get(path);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it.each([
    '/media/..%2f..%2fpackage.json',
    '/media/../package.json',
    '/media/blog/',
    '/media/.gitignore',
    '/media/blog/00000000-0000-7000-8000-000000000000-640.webp',
    '/media/blog/notes.txt',
  ])('answers the API 404 for %s (Review Focus 5)', async (url) => {
    const res = await request(app.getHttpServer()).get(url);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(notFound);
  });
});
