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

  it('documents the auth and admin DTOs exactly', () => {
    const doc = createOpenApiDocument(app);
    const propsOf = (name: string) =>
      Object.keys(
        (doc.components?.schemas?.[name] as { properties?: object } | undefined)?.properties ?? {},
      ).sort();
    expect(propsOf('CurrentUserDto')).toEqual(['avatarUrl', 'displayName', 'email', 'id', 'role']);
    expect(propsOf('AdminUserDto')).toEqual([
      'avatarUrl',
      'createdAt',
      'displayName',
      'email',
      'id',
      'role',
    ]);
  });

  it('keeps the OAuth callback out of the document', () => {
    const doc = createOpenApiDocument(app);
    expect(doc.paths['/auth/google/callback']).toBeUndefined();
    expect(doc.paths['/auth/google'].get).toBeDefined();
  });

  it('documents 404 and 409 ADMIN_ROLE_LOCKED on editor management', () => {
    const doc = createOpenApiDocument(app);
    for (const op of [
      doc.paths['/admin/editors/{userId}'].put,
      doc.paths['/admin/editors/{userId}'].delete,
    ]) {
      expect(Object.keys(op?.responses ?? {})).toEqual(
        expect.arrayContaining(['400', '401', '403', '404', '409', '500']),
      );
      expect(JSON.stringify(op?.responses['409'])).toContain('ADMIN_ROLE_LOCKED');
    }
  });

  it('every non-public operation documents 401, every state-changing one 403 (I18)', () => {
    const doc = createOpenApiDocument(app);
    const publicOperations = new Set([
      'get /services',
      'get /services/{slug}',
      'get /auth/google',
      'post /auth/logout',
    ]);
    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
    const missing: string[] = [];
    for (const [path, item] of Object.entries(doc.paths)) {
      if (path.startsWith('/__fixture')) continue; // test-only platform fixtures
      for (const method of methods) {
        const codes = Object.keys(item[method]?.responses ?? {});
        if (!item[method]) continue;
        const name = `${method} ${path}`;
        if (!publicOperations.has(name) && !codes.includes('401')) missing.push(`${name}: 401`);
        if (method !== 'get' && !codes.includes('403')) missing.push(`${name}: 403`);
      }
    }
    expect(missing).toEqual([]);
  });
});
