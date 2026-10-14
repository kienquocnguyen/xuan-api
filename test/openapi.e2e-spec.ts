import type { NestExpressApplication } from '@nestjs/platform-express';
import { createOpenApiDocument } from '../src/http/openapi/setup-open-api.js';
import { FixtureModule } from './fixtures/fixture.module.js';
import { createTestApp } from './support/create-test-app.js';

describe('OpenAPI document', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApp([FixtureModule]);
  });
  afterAll(async () => {
    await app.close();
  });

  it('builds with the shared named components', () => {
    const doc = createOpenApiDocument(app);
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining([
        'ErrorEnvelopeDto',
        'ValidationErrorDetailsDto',
        'FixtureEchoResultDto',
        'FixtureEchoDto',
      ]),
    );
    expect(Object.keys(doc.paths['/__fixture/echo'].post?.responses ?? {})).toEqual(
      expect.arrayContaining(['201', '400', '500']),
    );
  });
});
