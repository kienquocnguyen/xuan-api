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
      'get /posts/{slug}/related',
      'get /post-categories',
      'get /courses',
      'get /courses/{slug}',
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
    expect(params('/posts', 'get')).toEqual([
      'query:category:false', // blog completion B2
      'query:page:false',
      'query:pageSize:false',
    ]);
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
    const listParameters = (doc.paths['/posts'].get?.parameters ?? []) as {
      name: string;
      schema: object;
    }[];
    const pageSize = listParameters.find((p) => p.name === 'pageSize');
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

  describe('course catalog contract (course spec §11)', () => {
    const PUBLIC_COURSE_DTOS = [
      'CourseSummaryDto',
      'CourseDto',
      'CourseOutlineSectionDto',
      'CourseOutlineLessonDto',
    ];
    const schemaOf = (name: string) =>
      createOpenApiDocument(app).components?.schemas?.[name] as
        { properties?: Record<string, Record<string, unknown>>; required?: string[] } | undefined;
    const propsOf = (name: string) => Object.keys(schemaOf(name)?.properties ?? {}).sort();

    it('names every course request and response component (I19)', () => {
      const schemas = createOpenApiDocument(app).components?.schemas ?? {};
      expect(Object.keys(schemas)).toEqual(
        expect.arrayContaining([
          ...PUBLIC_COURSE_DTOS,
          'AdminCourseSummaryDto',
          'AdminCourseDto',
          'AdminCourseSectionDto',
          'AdminCourseLessonDto',
          'SaveCourseDto',
          'SaveCourseSectionDto',
          'SaveCourseLessonDto',
          'CurriculumOrderDto',
          'CourseIdParam',
          'CourseSectionIdParam',
          'CourseLessonIdParam',
        ]),
      );
    });

    it('documents the DTO fields exactly', () => {
      expect(propsOf('CourseSummaryDto')).toEqual([
        'id',
        'publishedAt',
        'slug',
        'summary',
        'title',
      ]);
      expect(propsOf('CourseDto')).toEqual([
        'id',
        'publishedAt',
        'sections',
        'slug',
        'summary',
        'title',
      ]);
      expect(propsOf('CourseOutlineSectionDto')).toEqual(['id', 'lessons', 'title']);
      expect(propsOf('CourseOutlineLessonDto')).toEqual(['durationSeconds', 'id', 'title']);
      expect(propsOf('AdminCourseSummaryDto')).toEqual([
        'id',
        'lessonCount',
        'publishedAt',
        'publishedLessonCount',
        'slug',
        'status',
        'summary',
        'title',
        'updatedAt',
      ]);
      expect(propsOf('AdminCourseDto')).toEqual(
        [...propsOf('AdminCourseSummaryDto'), 'createdAt', 'sections'].sort(),
      );
      expect(propsOf('AdminCourseSectionDto')).toEqual(['id', 'lessons', 'position', 'title']);
      expect(propsOf('AdminCourseLessonDto')).toEqual([
        'durationSeconds',
        'id',
        'position',
        'privacyHash',
        'status',
        'title',
        'updatedAt',
        'videoId',
      ]);
    });

    it('puts no video field on any public component (spec §7, §14)', () => {
      for (const name of PUBLIC_COURSE_DTOS) {
        expect({ name, props: propsOf(name).filter((p) => /video|vimeo|hash/i.test(p)) }).toEqual({
          name,
          props: [],
        });
      }
    });

    it('documents SaveCourseLessonDto as the validation behaves: optional, never null', () => {
      const lesson = schemaOf('SaveCourseLessonDto');
      expect(lesson?.required).toEqual(['title']);
      for (const field of ['videoId', 'privacyHash', 'durationSeconds']) {
        const schema = JSON.stringify(lesson?.properties?.[field]);
        expect(schema).not.toContain('nullable');
        expect(schema).not.toContain('"null"');
      }
      expect(lesson?.properties?.durationSeconds).toMatchObject({
        type: 'integer',
        minimum: 1,
        maximum: 86400,
      });
    });

    it('documents exactly the codes each course route can return (I18)', () => {
      const doc = createOpenApiDocument(app);
      const codes = (path: string, method: 'get' | 'put' | 'post' | 'delete') =>
        Object.entries(doc.paths[path]?.[method]?.responses ?? {})
          .filter(([status]) => Number(status) >= 400)
          .flatMap(([, response]) =>
            String((response as { description?: string }).description).split(' | '),
          )
          .sort();
      const input = [
        'FORBIDDEN',
        'INTERNAL_ERROR',
        'PAYLOAD_TOO_LARGE',
        'UNAUTHENTICATED',
        'VALIDATION_FAILED',
      ];
      const expected: Array<[string, 'get' | 'put' | 'post' | 'delete', string[]]> = [
        ['/courses', 'get', ['INTERNAL_ERROR']],
        ['/courses/{slug}', 'get', ['INTERNAL_ERROR', 'NOT_FOUND']],
        ['/admin/courses', 'get', ['FORBIDDEN', 'INTERNAL_ERROR', 'UNAUTHENTICATED']],
        ['/admin/courses', 'post', [...input, 'COURSE_SLUG_TAKEN']],
        ['/admin/courses/{courseId}', 'get', [...input, 'NOT_FOUND']],
        [
          '/admin/courses/{courseId}',
          'put',
          [...input, 'NOT_FOUND', 'COURSE_SLUG_TAKEN', 'COURSE_SLUG_LOCKED'],
        ],
        [
          '/admin/courses/{courseId}/publish',
          'post',
          [...input, 'NOT_FOUND', 'COURSE_NEEDS_PUBLISHED_LESSON'],
        ],
        ['/admin/courses/{courseId}/unpublish', 'post', [...input, 'NOT_FOUND']],
        ['/admin/courses/{courseId}/sections', 'post', [...input, 'NOT_FOUND']],
        ['/admin/course-sections/{sectionId}', 'put', [...input, 'NOT_FOUND']],
        [
          '/admin/course-sections/{sectionId}',
          'delete',
          [...input, 'NOT_FOUND', 'SECTION_NOT_EMPTY'],
        ],
        [
          '/admin/courses/{courseId}/curriculum-order',
          'put',
          [...input, 'NOT_FOUND', 'CURRICULUM_ORDER_MISMATCH'],
        ],
        ['/admin/course-sections/{sectionId}/lessons', 'post', [...input, 'NOT_FOUND']],
        [
          '/admin/course-lessons/{lessonId}',
          'put',
          [...input, 'NOT_FOUND', 'LESSON_VIDEO_MISSING'],
        ],
        [
          '/admin/course-lessons/{lessonId}/publish',
          'post',
          [...input, 'NOT_FOUND', 'LESSON_VIDEO_MISSING'],
        ],
        [
          '/admin/course-lessons/{lessonId}/unpublish',
          'post',
          [...input, 'NOT_FOUND', 'COURSE_NEEDS_PUBLISHED_LESSON'],
        ],
        [
          '/admin/course-lessons/{lessonId}',
          'delete',
          // Outcome 3 widens this 409 union (spec §11.6 compile-time caveat).
          [...input, 'NOT_FOUND', 'LESSON_IS_PUBLISHED', 'LESSON_HAS_PROGRESS'],
        ],
      ];
      for (const [path, method, routeCodes] of expected) {
        expect({ route: `${method} ${path}`, codes: codes(path, method) }).toEqual({
          route: `${method} ${path}`,
          codes: [...routeCodes].sort(),
        });
      }
    });

    it('documents the path ids as uuids, the 204 deletes and the order body', () => {
      const doc = createOpenApiDocument(app);
      type Parameter = { name: string; in: string; schema?: { format?: string } };
      const params = (path: string, method: 'put' | 'delete') =>
        (doc.paths[path]?.[method]?.parameters ?? []) as Parameter[];
      const uuidPath = (name: string) =>
        expect.objectContaining({
          name,
          in: 'path',
          schema: expect.objectContaining({ format: 'uuid' }),
        });
      expect(params('/admin/courses/{courseId}', 'put')).toEqual([uuidPath('courseId')]);
      expect(params('/admin/course-sections/{sectionId}', 'put')).toEqual([uuidPath('sectionId')]);
      expect(params('/admin/course-lessons/{lessonId}', 'delete')).toEqual([uuidPath('lessonId')]);
      for (const path of [
        '/admin/course-sections/{sectionId}',
        '/admin/course-lessons/{lessonId}',
      ]) {
        expect(Object.keys(doc.paths[path]?.delete?.responses ?? {})).toContain('204');
      }
      expect(
        JSON.stringify(doc.paths['/admin/courses/{courseId}/curriculum-order']?.put?.requestBody),
      ).toContain('#/components/schemas/CurriculumOrderDto');
    });
  });

  describe('course access contract (course spec §11.2, §11.4)', () => {
    const LEARNER_DTOS = [
      'LearnerCourseSummaryDto',
      'LearnerCourseDto',
      'LearnerCourseSectionDto',
      'LearnerCourseLessonDto',
    ];
    const schemaOf = (name: string) =>
      createOpenApiDocument(app).components?.schemas?.[name] as
        { properties?: Record<string, Record<string, unknown>> } | undefined;
    const propsOf = (name: string) => Object.keys(schemaOf(name)?.properties ?? {}).sort();
    const codes = (path: string, method: 'get' | 'put' | 'delete') =>
      Object.entries(createOpenApiDocument(app).paths[path]?.[method]?.responses ?? {})
        .filter(([status]) => Number(status) >= 400)
        .flatMap(([, response]) =>
          String((response as { description?: string }).description).split(' | '),
        )
        .sort();

    it('names every new request and response component (I19)', () => {
      expect(Object.keys(createOpenApiDocument(app).components?.schemas ?? {})).toEqual(
        expect.arrayContaining([
          ...LEARNER_DTOS,
          'CourseAccessGrantDto',
          'CourseAccessUserDto',
          'LessonPlaybackDto',
          'VimeoVideoDto',
          'CourseAccessParams',
          'LessonPathParams',
        ]),
      );
    });

    it('documents the DTO fields exactly', () => {
      expect(propsOf('CourseAccessUserDto')).toEqual(['avatarUrl', 'displayName', 'id']);
      expect(propsOf('CourseAccessGrantDto')).toEqual([
        'grantedAt',
        'grantedBy',
        'id',
        'revokedAt',
        'revokedBy',
        'source',
        'user',
      ]);
      expect(propsOf('LearnerCourseSummaryDto')).toEqual([
        'completedLessons',
        'course',
        'resumeLessonId',
        'totalLessons',
      ]);
      expect(propsOf('LearnerCourseDto')).toEqual(['course', 'resumeLessonId', 'sections']);
      expect(propsOf('LearnerCourseSectionDto')).toEqual(['id', 'lessons', 'title']);
      expect(propsOf('LearnerCourseLessonDto')).toEqual([
        'durationSeconds',
        'id',
        'progress',
        'title',
      ]);
      expect(propsOf('LessonPlaybackDto')).toEqual([
        'durationSeconds',
        'id',
        'nextLessonId',
        'previousLessonId',
        'progress',
        'sectionTitle',
        'title',
        'video',
      ]);
      expect(propsOf('VimeoVideoDto')).toEqual(['privacyHash', 'provider', 'videoId']);
      expect(schemaOf('VimeoVideoDto')?.properties?.provider).toMatchObject({ enum: ['vimeo'] });
      expect(schemaOf('CourseAccessGrantDto')?.properties?.source).toMatchObject({
        enum: ['admin'],
      });
    });

    it('puts video fields only on LessonPlaybackDto and VimeoVideoDto (spec §7, §14)', () => {
      for (const name of [...LEARNER_DTOS, 'CourseAccessGrantDto', 'CourseAccessUserDto']) {
        expect({ name, props: propsOf(name).filter((p) => /video|vimeo|hash/i.test(p)) }).toEqual({
          name,
          props: [],
        });
      }
    });

    it('documents exactly the codes each access and learner route can return (I18)', () => {
      const input = ['INTERNAL_ERROR', 'PAYLOAD_TOO_LARGE', 'UNAUTHENTICATED', 'VALIDATION_FAILED'];
      const admin = [...input, 'FORBIDDEN', 'NOT_FOUND'];
      const expected: Array<[string, 'get' | 'put' | 'delete', string[]]> = [
        ['/admin/courses/{courseId}/access-grants', 'get', admin],
        ['/admin/courses/{courseId}/access/{userId}', 'put', admin],
        ['/admin/courses/{courseId}/access/{userId}', 'delete', admin],
        ['/learn/courses', 'get', ['INTERNAL_ERROR', 'UNAUTHENTICATED']],
        [
          '/learn/courses/{slug}',
          'get',
          ['COURSE_ACCESS_REQUIRED', 'INTERNAL_ERROR', 'NOT_FOUND', 'UNAUTHENTICATED'],
        ],
        [
          '/learn/courses/{slug}/lessons/{lessonId}',
          'get',
          [...input, 'COURSE_ACCESS_REQUIRED', 'NOT_FOUND'],
        ],
      ];
      for (const [path, method, routeCodes] of expected) {
        expect({ route: `${method} ${path}`, codes: codes(path, method) }).toEqual({
          route: `${method} ${path}`,
          codes: [...routeCodes].sort(),
        });
      }
      const forbidden = createOpenApiDocument(app).paths['/learn/courses/{slug}']?.get?.responses?.[
        '403'
      ] as { description?: string } | undefined;
      expect(forbidden?.description).toBe('COURSE_ACCESS_REQUIRED');
    });

    it('documents the path ids as uuids and the revoke as 204', () => {
      const doc = createOpenApiDocument(app);
      type Parameter = { name: string; in: string; schema?: { format?: string } };
      const params = (path: string, method: 'get' | 'put') =>
        (doc.paths[path]?.[method]?.parameters ?? []) as Parameter[];
      const uuidPath = (name: string) =>
        expect.objectContaining({
          name,
          in: 'path',
          schema: expect.objectContaining({ format: 'uuid' }),
        });
      expect(params('/admin/courses/{courseId}/access/{userId}', 'put')).toEqual([
        uuidPath('courseId'),
        uuidPath('userId'),
      ]);
      expect(params('/learn/courses/{slug}/lessons/{lessonId}', 'get')).toEqual([
        expect.objectContaining({ name: 'slug', in: 'path' }),
        uuidPath('lessonId'),
      ]);
      expect(
        Object.keys(
          doc.paths['/admin/courses/{courseId}/access/{userId}']?.delete?.responses ?? {},
        ),
      ).toContain('204');
    });
  });

  describe('lesson progress contract (course spec §9.2, §11.6 outcome 3)', () => {
    const path = '/learn/courses/{slug}/lessons/{lessonId}/progress';
    const schemaOf = (name: string) =>
      createOpenApiDocument(app).components?.schemas?.[name] as
        { properties?: Record<string, Record<string, unknown>>; required?: string[] } | undefined;

    it('names the progress components and documents their fields', () => {
      expect(Object.keys(createOpenApiDocument(app).components?.schemas ?? {})).toEqual(
        expect.arrayContaining(['LessonProgressDto', 'SaveLessonProgressDto']),
      );
      expect(Object.keys(schemaOf('LessonProgressDto')?.properties ?? {}).sort()).toEqual([
        'completed',
        'positionSeconds',
      ]);
      const save = schemaOf('SaveLessonProgressDto');
      expect(Object.keys(save?.properties ?? {}).sort()).toEqual(['completed', 'positionSeconds']);
      expect(save?.required).toEqual(['positionSeconds']);
      expect(save?.properties?.positionSeconds).toMatchObject({
        type: 'integer',
        minimum: 0,
        maximum: 86400,
      });
    });

    it('documents the save as a 204 with its body, path parameters and exact codes (I18)', () => {
      const doc = createOpenApiDocument(app);
      const op = doc.paths[path]?.put;
      expect(Object.keys(op?.responses ?? {})).toContain('204');
      expect(JSON.stringify(op?.requestBody)).toContain(
        '#/components/schemas/SaveLessonProgressDto',
      );
      const codes = Object.entries(op?.responses ?? {})
        .filter(([status]) => Number(status) >= 400)
        .flatMap(([, response]) =>
          String((response as { description?: string }).description).split(' | '),
        )
        .sort();
      expect(codes).toEqual(
        [
          'COURSE_ACCESS_REQUIRED',
          'FORBIDDEN',
          'INTERNAL_ERROR',
          'NOT_FOUND',
          'PAYLOAD_TOO_LARGE',
          'UNAUTHENTICATED',
          'VALIDATION_FAILED',
        ].sort(),
      );
      type Parameter = { name: string; in: string; schema?: { format?: string } };
      expect((op?.parameters ?? []) as Parameter[]).toEqual([
        expect.objectContaining({ name: 'slug', in: 'path' }),
        expect.objectContaining({
          name: 'lessonId',
          in: 'path',
          schema: expect.objectContaining({ format: 'uuid' }),
        }),
      ]);
    });
  });

  describe('blog lifecycle and tags contract (blog completion B1)', () => {
    const doc = () => createOpenApiDocument(app);
    const schemaOf = (name: string) =>
      doc().components?.schemas?.[name] as
        { properties?: Record<string, Record<string, unknown>> } | undefined;
    const propsOf = (name: string) => Object.keys(schemaOf(name)?.properties ?? {}).sort();
    const codes = (path: string, method: 'get' | 'put' | 'post' | 'delete') =>
      Object.entries(doc().paths[path]?.[method]?.responses ?? {})
        .filter(([status]) => Number(status) >= 400)
        .flatMap(([, response]) =>
          String((response as { description?: string }).description).split(' | '),
        )
        .sort();
    const base = [
      'FORBIDDEN',
      'INTERNAL_ERROR',
      'NOT_FOUND',
      'PAYLOAD_TOO_LARGE',
      'UNAUTHENTICATED',
      'VALIDATION_FAILED',
    ];

    it('documents exactly the codes of every post write (I18)', () => {
      expect(codes('/admin/posts/{id}/archive', 'post')).toEqual(base);
      expect(codes('/admin/posts/{id}/restore', 'post')).toEqual(base);
      expect(codes('/admin/posts/{id}', 'delete')).toEqual(
        [...base, 'POST_ARCHIVED', 'POST_WAS_PUBLISHED'].sort(),
      );
      // publish and PUT gain the B2 category codes (pinned in the categories contract below).
      expect(codes('/admin/posts/{id}/unpublish', 'post')).toEqual(
        [...base, 'POST_ARCHIVED'].sort(),
      );
    });

    it('documents the delete as 204 with no body and the new routes with the id parameter', () => {
      const remove = doc().paths['/admin/posts/{id}']?.delete;
      expect(Object.keys(remove?.responses ?? {})).toContain('204');
      expect(JSON.stringify(remove?.responses['204'])).not.toContain('content');
      for (const verb of ['archive', 'restore']) {
        const params = (doc().paths[`/admin/posts/{id}/${verb}`]?.post?.parameters ?? []) as {
          name: string;
          in: string;
        }[];
        expect(params.map((p) => `${p.in}:${p.name}`)).toEqual(['path:id']);
      }
    });

    it('widens the status enum and adds the fields additively', () => {
      expect(schemaOf('AdminPostSummaryDto')?.properties?.status?.enum).toEqual([
        'draft',
        'published',
        'archived',
      ]);
      expect(JSON.stringify(schemaOf('AdminPostsQuery'))).toContain('archived');
      expect(propsOf('PostSummaryDto')).toEqual(
        [
          'author',
          'category',
          'coverImage', // B3
          'excerpt',
          'id',
          'publishedAt',
          'slug',
          'title',
          'updatedAt',
        ].sort(),
      );
      expect(propsOf('PostDto')).toEqual(
        expect.arrayContaining(['tags', 'updatedAt', 'body', 'bodyVersion']),
      );
      expect(propsOf('AdminPostSummaryDto')).toContain('tags');
      expect(propsOf('AdminPostDto')).toContain('tags');
      expect(propsOf('SavePostDto')).toEqual(
        [
          'body',
          'bodyVersion', // B3
          'categoryId',
          'coverAlt', // B3
          'coverMediaId', // B3
          'excerpt',
          'ogMediaId', // B3
          'seoDescription',
          'seoTitle',
          'slug',
          'tags',
          'title',
        ].sort(),
      );
      expect(JSON.stringify(schemaOf('SavePostDto')?.properties?.tags)).toContain('null');
    });
  });

  describe('blog categories contract (blog completion B2)', () => {
    const doc = () => createOpenApiDocument(app);
    const propsOf = (name: string) =>
      Object.keys(
        (doc().components?.schemas?.[name] as { properties?: object } | undefined)?.properties ??
          {},
      ).sort();
    const codes = (path: string, method: 'get' | 'put' | 'post' | 'delete') =>
      Object.entries(doc().paths[path]?.[method]?.responses ?? {})
        .filter(([status]) => Number(status) >= 400)
        .flatMap(([, response]) =>
          String((response as { description?: string }).description).split(' | '),
        )
        .sort();
    const input = [
      'FORBIDDEN',
      'INTERNAL_ERROR',
      'PAYLOAD_TOO_LARGE',
      'UNAUTHENTICATED',
      'VALIDATION_FAILED',
    ];
    const withId = [...input, 'NOT_FOUND'];
    const sorted = (...lists: string[][]) => lists.flat().sort();

    it('names every category component (I19)', () => {
      expect(Object.keys(doc().components?.schemas ?? {})).toEqual(
        expect.arrayContaining([
          'CreatePostCategoryDto',
          'UpdatePostCategoryDto',
          'PostCategoryIdParam',
          'AdminPostCategoryDto',
          'PostCategoryDto',
          'PostCategoryRefDto',
          'AdminPostCategoryRefDto',
        ]),
      );
      expect(propsOf('AdminPostCategoryDto')).toEqual(
        ['createdAt', 'id', 'key', 'label', 'postCount', 'slug', 'status', 'updatedAt'].sort(),
      );
      expect(propsOf('PostCategoryDto')).toEqual(['label', 'publishedPostCount', 'slug']);
      expect(propsOf('PostCategoryRefDto')).toEqual(['label', 'slug']);
      expect(propsOf('AdminPostCategoryRefDto')).toEqual(['id', 'key', 'label', 'slug', 'status']);
      expect(propsOf('PostSummaryDto')).toContain('category');
      expect(propsOf('AdminPostSummaryDto')).toContain('category');
      expect(propsOf('SavePostDto')).toContain('categoryId');
      expect(JSON.stringify(doc().components?.schemas?.PostsPageQuery)).toContain('category');
      // Nullable on the wire: the generated web types must allow null (final review).
      const prop = (schema: string, name: string) =>
        JSON.stringify(
          (doc().components?.schemas?.[schema] as { properties?: Record<string, unknown> })
            ?.properties?.[name],
        );
      expect(prop('PostSummaryDto', 'category')).toContain('"nullable":true');
      expect(prop('AdminPostSummaryDto', 'category')).toContain('"nullable":true');
      expect(prop('SavePostDto', 'categoryId')).toContain('null');
    });

    it('documents exactly the codes each category route can return (I18)', () => {
      expect(codes('/admin/post-categories', 'get')).toEqual(
        ['FORBIDDEN', 'INTERNAL_ERROR', 'UNAUTHENTICATED'].sort(),
      );
      expect(codes('/admin/post-categories', 'post')).toEqual(
        sorted(input, ['CATEGORY_KEY_TAKEN', 'CATEGORY_SLUG_TAKEN']),
      );
      expect(codes('/admin/post-categories/{categoryId}', 'put')).toEqual(
        sorted(withId, ['CATEGORY_SLUG_TAKEN']),
      );
      expect(codes('/admin/post-categories/{categoryId}/archive', 'post')).toEqual(sorted(withId));
      expect(codes('/admin/post-categories/{categoryId}/restore', 'post')).toEqual(sorted(withId));
      expect(codes('/admin/post-categories/{categoryId}', 'delete')).toEqual(
        sorted(withId, ['CATEGORY_IN_USE']),
      );
      expect(codes('/post-categories', 'get')).toEqual(['INTERNAL_ERROR']);
      expect(codes('/posts', 'get')).toEqual(
        ['INTERNAL_ERROR', 'NOT_FOUND', 'PAYLOAD_TOO_LARGE', 'VALIDATION_FAILED'].sort(),
      );
      expect(codes('/posts/{slug}/related', 'get')).toEqual(['INTERNAL_ERROR', 'NOT_FOUND']);
    });

    it('adds the category codes to the post writes (I18)', () => {
      expect(codes('/admin/posts', 'post')).toEqual(
        // + B3 media code
        sorted(input, [
          'POST_SLUG_TAKEN',
          'CATEGORY_NOT_FOUND',
          'CATEGORY_ARCHIVED',
          'POST_MEDIA_NOT_FOUND',
        ]),
      );
      expect(codes('/admin/posts/{id}', 'put')).toEqual(
        sorted(withId, [
          'POST_BODY_EMPTY',
          'POST_FIELDS_OMITTED',
          'POST_SLUG_LOCKED',
          'POST_SLUG_TAKEN',
          'POST_CATEGORY_REQUIRED',
          'CATEGORY_NOT_FOUND',
          'CATEGORY_ARCHIVED',
          'POST_MEDIA_NOT_FOUND', // B3
          'POST_MEDIA_INCOMPLETE',
          'POST_BODY_VERSION_UNSUPPORTED',
        ]),
      );
      expect(codes('/admin/posts/{id}/publish', 'post')).toEqual(
        sorted(withId, [
          'POST_ARCHIVED',
          'POST_BODY_EMPTY',
          'POST_CATEGORY_REQUIRED',
          'CATEGORY_ARCHIVED',
          'POST_MEDIA_INCOMPLETE', // B3
        ]),
      );
    });
  });
});
