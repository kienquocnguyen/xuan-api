import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { FixtureModule } from './fixtures/fixture.module.js';
import { createTestApp } from './support/create-test-app.js';

const envelope = (code: string, message: string, details: object = {}) => ({
  data: null,
  error: { code, message, details },
});

describe('HTTP contract (fixture)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApp([FixtureModule]);
  });
  afterAll(async () => {
    await app.close();
  });

  it('payload → { data }', async () => {
    const res = await request(app.getHttpServer()).get('/__fixture/payload');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { hello: 'world' } });
  });

  it('@HttpCode(204) → empty body', async () => {
    const res = await request(app.getHttpServer()).post('/__fixture/no-content');
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
  });

  it('undefined from a payload route → 500 bug, not {}', async () => {
    const res = await request(app.getHttpServer()).get('/__fixture/undefined');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('valid body → echoed in { data }', async () => {
    const body = { name: 'Xuan', address: { city: 'HCM' } };
    const res = await request(app.getHttpServer()).post('/__fixture/echo').send(body);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ data: body });
  });

  it('invalid body → VALIDATION_FAILED with dot paths and field codes', async () => {
    const res = await request(app.getHttpServer())
      .post('/__fixture/echo')
      .send({ name: 'toolong', address: { city: 3 }, tags: ['abcd'], isAdmin: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.fields).toEqual(
      expect.arrayContaining([
        { field: 'name', code: 'TOO_LONG', message: 'This value is too long.' },
        { field: 'address.city', code: 'INVALID_TYPE', message: 'This value has the wrong type.' },
        { field: 'tags.0', code: 'TOO_LONG', message: 'This value is too long.' },
        { field: 'isAdmin', code: 'UNKNOWN_FIELD', message: 'This field is not allowed.' },
      ]),
    );
  });

  it('missing required field → REQUIRED', async () => {
    const res = await request(app.getHttpServer())
      .post('/__fixture/echo')
      .send({ address: { city: 'HCM' } });
    expect(res.body.error.details.fields).toEqual([
      { field: 'name', code: 'REQUIRED', message: 'This field is required.' },
    ]);
  });

  it('AppError → its envelope and status', async () => {
    const res = await request(app.getHttpServer()).get('/__fixture/app-error');
    expect(res.status).toBe(404);
    expect(res.body).toEqual(envelope('NOT_FOUND', 'The requested resource was not found.'));
  });

  it('unknown route → NOT_FOUND envelope', async () => {
    const res = await request(app.getHttpServer()).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual(envelope('NOT_FOUND', 'The requested resource was not found.'));
  });

  it('unexpected error → generic 500, internals not leaked', async () => {
    const res = await request(app.getHttpServer()).get('/__fixture/crash');
    expect(res.status).toBe(500);
    expect(res.body).toEqual(envelope('INTERNAL_ERROR', 'Something went wrong. Please try again.'));
    expect(JSON.stringify(res.body)).not.toContain('secret_table');
  });

  it('malformed JSON → VALIDATION_FAILED with no fields', async () => {
    const res = await request(app.getHttpServer())
      .post('/__fixture/echo')
      .set('Content-Type', 'application/json')
      .send('{"name":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      envelope('VALIDATION_FAILED', 'The request body is not valid JSON.', { fields: [] }),
    );
  });

  it('body over 100kb → PAYLOAD_TOO_LARGE', async () => {
    const res = await request(app.getHttpServer())
      .post('/__fixture/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ name: 'x'.repeat(200_000) }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual(envelope('PAYLOAD_TOO_LARGE', 'The request body is too large.'));
  });
});
