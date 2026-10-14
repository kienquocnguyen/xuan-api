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
      expect.arrayContaining(['201', '400', '413', '500']),
    );
  });

  it('types details.fields on VALIDATION_FAILED responses (I18)', () => {
    const doc = createOpenApiDocument(app);
    const badRequest = JSON.stringify(doc.paths['/__fixture/echo'].post?.responses['400']);
    expect(badRequest).toContain('#/components/schemas/ValidationErrorDetailsDto');
    const tooLarge = JSON.stringify(doc.paths['/__fixture/echo'].post?.responses['413']);
    expect(tooLarge).toContain('PAYLOAD_TOO_LARGE');
  });

  it('documents the services endpoints', () => {
    const doc = createOpenApiDocument(app);
    const serviceDto = doc.components?.schemas?.ServiceDto as { properties?: object } | undefined;
    expect(Object.keys(serviceDto?.properties ?? {}).sort()).toEqual([
      'id',
      'slug',
      'summary',
      'title',
    ]);
    expect(Object.keys(doc.paths['/services'].get?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '500']),
    );
    expect(Object.keys(doc.paths['/services/{slug}'].get?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '404', '500']),
    );
    expect(JSON.stringify(doc.paths['/services/{slug}'].get?.responses['404'])).toContain(
      'NOT_FOUND',
    );
  });
});
