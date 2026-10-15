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

  it('declares query and path parameters from the named request schemas', () => {
    const doc = createOpenApiDocument(app);
    const schemas = (doc.components?.schemas ?? {}) as Record<
      string,
      { properties?: Record<string, object> }
    >;
    const propertyOf = (component: string, property: string) =>
      schemas[component]?.properties?.[property];
    // The request component ids stay registered: they're consumer contract identifiers (I19).
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining(['AdminUsersQuery', 'GoogleSignInQuery', 'EditorTarget']),
    );

    expect(doc.paths['/admin/users'].get?.parameters).toEqual([
      {
        name: 'role',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['user', 'editor', 'admin'] },
      },
    ]);
    expect(doc.paths['/auth/google'].get?.parameters).toEqual([
      {
        name: 'returnTo',
        in: 'query',
        required: false,
        schema: propertyOf('GoogleSignInQuery', 'returnTo'),
      },
    ]);
    const userId = {
      name: 'userId',
      in: 'path',
      required: true,
      schema: propertyOf('EditorTarget', 'userId'),
    };
    expect(propertyOf('EditorTarget', 'userId')).toMatchObject({ type: 'string', format: 'uuid' });
    expect(doc.paths['/admin/editors/{userId}'].put?.parameters).toEqual([userId]);
    expect(doc.paths['/admin/editors/{userId}'].delete?.parameters).toEqual([userId]);
  });

  it('declares every templated path segment as a required path parameter', () => {
    const doc = createOpenApiDocument(app);
    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
    const missing: string[] = [];
    for (const [path, item] of Object.entries(doc.paths)) {
      const segments = [...path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => name);
      for (const method of methods) {
        const operation = item[method];
        if (!operation) continue;
        const declared = (operation.parameters ?? []) as {
          name: string;
          in: string;
          required?: boolean;
        }[];
        for (const name of segments) {
          const param = declared.find((p) => p.in === 'path' && p.name === name);
          if (param?.required !== true) missing.push(`${method} ${path}: ${name}`);
        }
      }
    }
    expect(missing).toEqual([]);
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
      'get /posts',
      'get /posts/{slug}',
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

  it('documents the blog components and parameters', () => {
    const doc = createOpenApiDocument(app);
    const schemas = doc.components?.schemas ?? {};
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        'SavePostDto',
        'PostsPageQuery',
        'AdminPostsQuery',
        'PostIdParam',
        'PostBodyDocument',
        'PostBodyNode',
        'PostBodyMark',
        'PostAuthorDto',
        'PostSummaryDto',
        'PostDto',
        'AdminPostAuthorDto',
        'AdminPostSummaryDto',
        'AdminPostDto',
        'PageInfoDto',
      ]),
    );
    const params = (path: string, method: 'get' | 'put' | 'post') =>
      (
        (doc.paths[path][method]?.parameters ?? []) as {
          name: string;
          in: string;
          required?: boolean;
        }[]
      )
        .map((p) => `${p.in}:${p.name}:${p.required === true}`)
        .sort();
    expect(params('/posts', 'get')).toEqual(['query:page:false', 'query:pageSize:false']);
    expect(params('/admin/posts', 'get')).toEqual([
      'query:page:false',
      'query:pageSize:false',
      'query:status:false',
    ]);
    for (const [path, method] of [
      ['/admin/posts/{id}', 'get'],
      ['/admin/posts/{id}', 'put'],
      ['/admin/posts/{id}/publish', 'post'],
      ['/admin/posts/{id}/unpublish', 'post'],
    ] as const) {
      expect(params(path, method)).toEqual(['path:id:true']);
    }
    const pageSize = (
      doc.paths['/posts'].get?.parameters as { name: string; schema: object }[]
    ).find((p) => p.name === 'pageSize');
    expect(pageSize?.schema).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 50,
      default: 12,
    });
    expect(JSON.stringify(doc.paths['/admin/posts'].post?.requestBody)).toContain(
      '#/components/schemas/SavePostDto',
    );
    expect(JSON.stringify(schemas.PostDto)).toContain('#/components/schemas/PostBodyDocument');
    expect(JSON.stringify(schemas.AdminPostDto)).toContain('#/components/schemas/PostBodyDocument');
    expect(JSON.stringify(schemas.PostBodyNode)).toContain('#/components/schemas/PostBodyNode'); // recursion by $ref
    expect(JSON.stringify(doc.paths['/posts'].get?.responses['200'])).toContain(
      '#/components/schemas/PageInfoDto',
    );
  });

  it('documents every post error code (I18)', () => {
    const doc = createOpenApiDocument(app);
    const codes = (path: string, method: 'get' | 'put' | 'post') =>
      JSON.stringify(doc.paths[path][method]?.responses);
    expect(codes('/admin/posts', 'post')).toContain('POST_SLUG_TAKEN');
    for (const code of ['POST_SLUG_TAKEN', 'POST_SLUG_LOCKED', 'POST_BODY_EMPTY', 'NOT_FOUND']) {
      expect(codes('/admin/posts/{id}', 'put')).toContain(code);
    }
    expect(codes('/admin/posts/{id}/publish', 'post')).toContain('POST_BODY_EMPTY');
    expect(codes('/admin/posts/{id}/unpublish', 'post')).not.toContain('POST_BODY_EMPTY');
    expect(codes('/posts/{slug}', 'get')).toContain('NOT_FOUND');
  });
});
