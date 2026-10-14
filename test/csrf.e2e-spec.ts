import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { FixtureModule } from './fixtures/fixture.module.js';
import { createTestApp } from './support/create-test-app.js';

const forbidden = {
  data: null,
  error: { code: 'FORBIDDEN', message: 'You are not allowed to do this.', details: {} },
};

describe('CSRF defense on state-changing requests (api-contract §8)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApp([FixtureModule]);
  });
  afterAll(async () => {
    await app.close();
  });

  const post = () => request(app.getHttpServer()).post('/__fixture/no-content');

  it('rejects a POST without X-Requested-With', async () => {
    const res = await post();
    expect(res.status).toBe(403);
    expect(res.body).toEqual(forbidden);
  });

  it('rejects a POST from a foreign Origin even with the header', async () => {
    const res = await post()
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.body).toEqual(forbidden);
  });

  it('accepts a POST from an allowed Origin with the header', async () => {
    const res = await post()
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Origin', 'http://localhost:3000');
    expect(res.status).toBe(204);
  });

  it('accepts a POST without Origin (non-browser client) with the header', async () => {
    const res = await post().set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(204);
  });

  it('leaves safe methods alone', async () => {
    const res = await request(app.getHttpServer()).get('/__fixture/payload');
    expect(res.status).toBe(200);
  });
});
