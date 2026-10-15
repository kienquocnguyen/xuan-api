import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { XHR } from './support/auth.js';
import { createTestApp } from './support/create-test-app.js';

// Non-mutating: every request below is rejected before anything is written (spec B15).
const UNKNOWN_ID = '01900000-0000-7000-8000-000000000000';
const envelope = (code: string, message: string) => ({
  data: null,
  error: { code, message, details: {} },
});
const tooLarge = envelope('PAYLOAD_TOO_LARGE', 'The request body is too large.');
const unauthenticated = envelope('UNAUTHENTICATED', 'You need to sign in.');
const jsonOf = (bytes: number) => JSON.stringify({ title: 'x'.repeat(bytes) });

describe('post write body limit (spec B15)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  const send = (method: 'post' | 'put', path: string, body: string) =>
    request(app.getHttpServer())
      [method](path)
      .set(XHR)
      .set('Content-Type', 'application/json')
      .send(body);

  const postWrites = [
    ['post', '/admin/posts'],
    ['put', `/admin/posts/${UNKNOWN_ID}`],
  ] as const;

  it.each(postWrites)(
    '%s %s parses up to 512 kB (reaches the access guard)',
    async (method, path) => {
      const res = await send(method, path, jsonOf(400_000));
      expect(res.status).toBe(401);
      expect(res.body).toEqual(unauthenticated);
    },
  );

  it.each(postWrites)('%s %s rejects more than 512 kB with 413', async (method, path) => {
    const res = await send(method, path, jsonOf(600_000));
    expect(res.status).toBe(413);
    expect(res.body).toEqual(tooLarge);
  });

  it.each([
    ['post', `/admin/posts/${UNKNOWN_ID}/publish`],
    ['post', '/auth/logout'],
  ] as const)('%s %s keeps the 100 kB limit', async (method, path) => {
    const res = await send(method, path, jsonOf(200_000));
    expect(res.status).toBe(413);
    expect(res.body).toEqual(tooLarge);
  });

  it('keeps the invalid-JSON message on post writes', async () => {
    const res = await send('post', '/admin/posts', '{"title":');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('The request body is not valid JSON.');
  });

  it('parses a 10 000-level document (~350 kB) without crashing', async () => {
    let deep = '{"type":"paragraph"}';
    for (let i = 0; i < 10_000; i++) deep = `{"type":"blockquote","content":[${deep}]}`;
    const res = await send('post', '/admin/posts', `{"body":{"type":"doc","content":[${deep}]}}`);
    expect(res.status).toBe(401); // parsed, then stopped by the access guard; depth → 400 is in admin-posts
  });
});
