import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { FixtureModule } from './fixtures/fixture.module.js';
import { createTestApp } from './support/create-test-app.js';

describe('CORS and body parsing', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApp([FixtureModule]);
  });
  afterAll(async () => {
    await app.close();
  });

  it('allowed origin → credentialed CORS headers', async () => {
    const res = await request(app.getHttpServer())
      .options('/__fixture/echo')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-requested-with');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-headers']?.toLowerCase()).toContain(
      'x-requested-with',
    );
  });

  it('disallowed origin → no allow-origin header', async () => {
    const res = await request(app.getHttpServer())
      .get('/__fixture/payload')
      .set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each([
    ['form-encoded', 'application/x-www-form-urlencoded', 'name=Xuan&address[city]=HCM'],
    ['text/plain', 'text/plain', '{"name":"Xuan","address":{"city":"HCM"}}'],
  ])('%s body is not parsed → VALIDATION_FAILED', async (_n, type, payload) => {
    const res = await request(app.getHttpServer())
      .post('/__fixture/echo')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Content-Type', type)
      .send(payload);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('error responses to an allowed origin still carry CORS headers', async () => {
    const res = await request(app.getHttpServer())
      .post('/__fixture/echo')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Origin', 'http://localhost:3000')
      .set('Content-Type', 'application/json')
      .send('{"name":');
    expect(res.status).toBe(400);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('sets helmet security headers', async () => {
    const res = await request(app.getHttpServer()).get('/__fixture/payload');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
