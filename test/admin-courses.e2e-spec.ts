import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { signInAs, type TestUser, XHR } from './support/auth.js';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNKNOWN_ID = '01900000-0000-7000-8000-000000000000';

const envelope = (code: string, message: string, details: object = {}) => ({
  data: null,
  error: { code, message, details },
});
const unauthenticated = envelope('UNAUTHENTICATED', 'You need to sign in.');
const forbidden = envelope('FORBIDDEN', 'You are not allowed to do this.');
const notFound = envelope('NOT_FOUND', 'The requested resource was not found.');
const slugTaken = envelope('COURSE_SLUG_TAKEN', 'Another course already uses this slug.');
const slugLocked = envelope('COURSE_SLUG_LOCKED', 'A published course keeps its slug.');
const needsLesson = envelope(
  'COURSE_NEEDS_PUBLISHED_LESSON',
  'A published course needs at least one published lesson.',
);
const FIELD_MESSAGES: Record<string, string> = {
  REQUIRED: 'This field is required.',
  INVALID_TYPE: 'This value has the wrong type.',
  INVALID_FORMAT: 'This value has an invalid format.',
  TOO_SHORT: 'This value is too short.',
  TOO_LONG: 'This value is too long.',
  TOO_SMALL: 'This value is too small.',
  TOO_LARGE: 'This value is too large.',
  UNKNOWN_FIELD: 'This field is not allowed.',
  INVALID: 'This value is invalid.',
};
/** A 400 with exactly these `[field, code]` pairs and their fixed per-code messages. */
const invalid = (...fields: Array<[string, string]>) =>
  envelope('VALIDATION_FAILED', 'The request is invalid.', {
    fields: fields.map(([field, code]) => ({ field, message: FIELD_MESSAGES[code], code })),
  });

const saveCourse = (overrides: Record<string, unknown> = {}) => ({
  slug: 'workflow-edit-video-youtube',
  title: 'Workflow edit video YouTube',
  summary: 'Quy trình dựng video từ A đến Z.',
  ...overrides,
});

describe('Admin course authoring (/admin/courses…)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let admin: { user: TestUser; cookie: string };

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    admin = await signInAs(app, { role: 'admin' });
  });
  afterAll(async () => {
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const create = (body: object, cookie = admin.cookie) =>
    server().post('/admin/courses').set(XHR).set('Cookie', cookie).send(body);
  const createdId = async (body: object = saveCourse()) => {
    const res = await create(body);
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };
  const get = (courseId: string) =>
    server().get(`/admin/courses/${courseId}`).set('Cookie', admin.cookie);
  const update = (courseId: string, body: object) =>
    server().put(`/admin/courses/${courseId}`).set(XHR).set('Cookie', admin.cookie).send(body);
  const courseAction = (courseId: string, action: 'publish' | 'unpublish') =>
    server().post(`/admin/courses/${courseId}/${action}`).set(XHR).set('Cookie', admin.cookie);

  /** A section holding one published lesson, written directly (independent of the curriculum routes). */
  const addPublishedLesson = async (courseId: string, position = 0) => {
    const [section] = await db.query<{ id: string }[]>(
      `INSERT INTO course_sections (course_id, title, position) VALUES ($1, 'Phần', $2) RETURNING id`,
      [courseId, position],
    );
    const [lesson] = await db.query<{ id: string }[]>(
      `INSERT INTO course_lessons (section_id, title, position, status, vimeo_video_id)
       VALUES ($1, 'Bài', 0, 'published', '76979871') RETURNING id`,
      [section.id],
    );
    return { sectionId: section.id, lessonId: lesson.id };
  };

  describe('courses', () => {
    it('creates a draft course with an empty curriculum (201)', async () => {
      const res = await create(saveCourse({ title: '  Workflow  ' }));
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        data: {
          id: expect.stringMatching(UUID),
          slug: 'workflow-edit-video-youtube',
          title: 'Workflow',
          summary: 'Quy trình dựng video từ A đến Z.',
          status: 'draft',
          publishedAt: null,
          updatedAt: expect.stringMatching(ISO),
          publishedLessonCount: 0,
          lessonCount: 0,
          createdAt: expect.stringMatching(ISO),
          sections: [],
        },
      });
    });

    it('refuses a slug another course uses (409 COURSE_SLUG_TAKEN)', async () => {
      await createdId();
      const res = await create(saveCourse({ title: 'Khác' }));
      expect(res.status).toBe(409);
      expect(res.body).toEqual(slugTaken);
    });

    it('lists courses, most recently updated first, with lesson counts', async () => {
      const first = await createdId(saveCourse({ slug: 'mot' }));
      const second = await createdId(saveCourse({ slug: 'hai' }));
      await addPublishedLesson(first);
      await db.query(
        `INSERT INTO course_lessons (section_id, title, position)
         SELECT id, 'Nháp', 1 FROM course_sections WHERE course_id = $1`,
        [first],
      );
      expect((await update(first, saveCourse({ slug: 'mot', title: 'Mới sửa' }))).status).toBe(200);

      const res = await server().get('/admin/courses').set('Cookie', admin.cookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        {
          id: first,
          slug: 'mot',
          title: 'Mới sửa',
          summary: 'Quy trình dựng video từ A đến Z.',
          status: 'draft',
          publishedAt: null,
          updatedAt: expect.stringMatching(ISO),
          publishedLessonCount: 1,
          lessonCount: 2,
        },
        expect.objectContaining({ id: second, publishedLessonCount: 0, lessonCount: 0 }),
      ]);
    });

    it('gets a course, and 404 for an unknown one', async () => {
      const id = await createdId();
      expect((await get(id)).body.data).toEqual(expect.objectContaining({ id, status: 'draft' }));
      const missing = await get(UNKNOWN_ID);
      expect(missing.status).toBe(404);
      expect(missing.body).toEqual(notFound);
    });

    it('rejects a malformed course id (400 INVALID_FORMAT)', async () => {
      const res = await get('not-a-uuid');
      expect(res.status).toBe(400);
      expect(res.body).toEqual(invalid(['courseId', 'INVALID_FORMAT']));
    });

    it('updates the slug, title and summary of a never-published course', async () => {
      const id = await createdId();
      const res = await update(
        id,
        saveCourse({ slug: 'moi', title: 'Tiêu đề mới', summary: 'Tóm tắt mới' }),
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(
        expect.objectContaining({ id, slug: 'moi', title: 'Tiêu đề mới', summary: 'Tóm tắt mới' }),
      );
    });

    it('refuses an update to a taken slug, and 404 for an unknown course', async () => {
      await createdId(saveCourse({ slug: 'da-co' }));
      const id = await createdId();
      const taken = await update(id, saveCourse({ slug: 'da-co' }));
      expect(taken.status).toBe(409);
      expect(taken.body).toEqual(slugTaken);
      const missing = await update(UNKNOWN_ID, saveCourse());
      expect(missing.status).toBe(404);
      expect(missing.body).toEqual(notFound);
    });

    it('refuses to publish without a published lesson (409 COURSE_NEEDS_PUBLISHED_LESSON)', async () => {
      const id = await createdId();
      await db.query(
        `WITH s AS (INSERT INTO course_sections (course_id, title, position) VALUES ($1, 'Phần', 0) RETURNING id)
         INSERT INTO course_lessons (section_id, title, position) SELECT id, 'Nháp', 0 FROM s`,
        [id],
      );
      const res = await courseAction(id, 'publish');
      expect(res.status).toBe(409);
      expect(res.body).toEqual(needsLesson);
      expect((await get(id)).body.data.status).toBe('draft');
    });

    it('publishes with a published lesson, idempotently, keeping the first publication instant', async () => {
      const id = await createdId();
      await addPublishedLesson(id);

      const published = await courseAction(id, 'publish');
      expect(published.status).toBe(200);
      expect(published.body.data).toEqual(
        expect.objectContaining({
          status: 'published',
          publishedAt: expect.stringMatching(ISO),
          publishedLessonCount: 1,
        }),
      );
      const { publishedAt, updatedAt } = published.body.data as {
        publishedAt: string;
        updatedAt: string;
      };

      const again = await courseAction(id, 'publish');
      expect(again.status).toBe(200);
      expect(again.body.data).toEqual(
        expect.objectContaining({ status: 'published', publishedAt, updatedAt }),
      );

      const unpublished = await courseAction(id, 'unpublish');
      expect(unpublished.status).toBe(200);
      expect(unpublished.body.data).toEqual(
        expect.objectContaining({ status: 'draft', publishedAt }),
      );
      const unpublishedAgain = await courseAction(id, 'unpublish');
      expect(unpublishedAgain.status).toBe(200);
      expect(unpublishedAgain.body.data.updatedAt).toBe(unpublished.body.data.updatedAt);

      const republished = await courseAction(id, 'publish');
      expect(republished.body.data).toEqual(
        expect.objectContaining({ status: 'published', publishedAt }),
      );
    });

    it('locks the slug after the first publication, also while unpublished (409 COURSE_SLUG_LOCKED)', async () => {
      const id = await createdId();
      await addPublishedLesson(id);
      await courseAction(id, 'publish');

      const whilePublished = await update(id, saveCourse({ slug: 'khac' }));
      expect(whilePublished.status).toBe(409);
      expect(whilePublished.body).toEqual(slugLocked);

      await courseAction(id, 'unpublish');
      const whileUnpublished = await update(id, saveCourse({ slug: 'khac' }));
      expect(whileUnpublished.status).toBe(409);
      expect(whileUnpublished.body).toEqual(slugLocked);

      // The same slug with new text is fine.
      const sameSlug = await update(id, saveCourse({ title: 'Tiêu đề mới' }));
      expect(sameSlug.status).toBe(200);
      expect(sameSlug.body.data.title).toBe('Tiêu đề mới');
    });

    it('gives 404 when publishing or unpublishing an unknown course', async () => {
      for (const action of ['publish', 'unpublish'] as const) {
        const res = await courseAction(UNKNOWN_ID, action);
        expect(res.status).toBe(404);
        expect(res.body).toEqual(notFound);
      }
    });

    it.each([
      ['a NUL in the title (Review Focus 1)', { title: '\u0000x' }, ['title', 'INVALID']],
      ['a lone surrogate in the summary', { summary: 'a\ud800' }, ['summary', 'INVALID']],
      ['a whitespace-only title', { title: ' \t\n ' }, ['title', 'TOO_SHORT']],
      ['a whitespace-only summary', { summary: ' 　' }, ['summary', 'TOO_SHORT']],
      ['a 201-character title', { title: 'a'.repeat(201) }, ['title', 'TOO_LONG']],
      ['a 501-character summary', { summary: 'a'.repeat(501) }, ['summary', 'TOO_LONG']],
      ['an uppercase slug', { slug: 'Khoa-Hoc' }, ['slug', 'INVALID_FORMAT']],
      ['an unknown key', { status: 'published' }, ['status', 'UNKNOWN_FIELD']],
    ] as const)('rejects %s on create and update (400)', async (_case, overrides, field) => {
      const created = await create(saveCourse(overrides));
      expect(created.status).toBe(400);
      expect(created.body).toEqual(invalid([...field]));
      const id = await createdId();
      const updated = await update(id, saveCourse(overrides));
      expect(updated.status).toBe(400);
      expect(updated.body).toEqual(invalid([...field]));
    });
  });

  describe('authorization', () => {
    /** Every admin course route, with a body where it takes one. */
    const routes: Array<{
      method: 'get' | 'post' | 'put' | 'delete';
      path: string;
      body?: object;
    }> = [
      { method: 'get', path: '/admin/courses' },
      { method: 'post', path: '/admin/courses', body: saveCourse() },
      { method: 'get', path: `/admin/courses/${UNKNOWN_ID}` },
      { method: 'put', path: `/admin/courses/${UNKNOWN_ID}`, body: saveCourse() },
      { method: 'post', path: `/admin/courses/${UNKNOWN_ID}/publish` },
      { method: 'post', path: `/admin/courses/${UNKNOWN_ID}/unpublish` },
    ];
    const send = (route: (typeof routes)[number], headers: Record<string, string>) => {
      const req = server()[route.method](route.path).set(headers);
      return route.body ? req.send(route.body) : req;
    };

    it('needs a session on every route (401)', async () => {
      for (const route of routes) {
        const res = await send(route, XHR);
        expect({ route: route.path, status: res.status, body: res.body }).toEqual({
          route: route.path,
          status: 401,
          body: unauthenticated,
        });
      }
    });

    it('refuses users and editors on every route (403)', async () => {
      for (const role of ['user', 'editor'] as const) {
        const { cookie } = await signInAs(app, { role });
        for (const route of routes) {
          const res = await send(route, { ...XHR, Cookie: cookie });
          expect({ role, route: route.path, status: res.status, body: res.body }).toEqual({
            role,
            route: route.path,
            status: 403,
            body: forbidden,
          });
        }
      }
    });

    it('needs the CSRF header on every write, even for an admin (403)', async () => {
      for (const route of routes.filter((r) => r.method !== 'get')) {
        const res = await send(route, { Cookie: admin.cookie });
        expect({ route: route.path, status: res.status, body: res.body }).toEqual({
          route: route.path,
          status: 403,
          body: forbidden,
        });
      }
    });
  });
});
