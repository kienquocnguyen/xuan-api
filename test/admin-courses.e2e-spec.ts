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
const videoMissing = envelope('LESSON_VIDEO_MISSING', 'A published lesson needs a Vimeo video.');
const lessonIsPublished = envelope(
  'LESSON_IS_PUBLISHED',
  'Unpublish the lesson before deleting it.',
);
const sectionNotEmpty = envelope(
  'SECTION_NOT_EMPTY',
  'Move or delete the lessons in this section first.',
);
const orderMismatch = envelope(
  'CURRICULUM_ORDER_MISMATCH',
  'The order must list every section and lesson of the course exactly once.',
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

  const addSection = (courseId: string, title: string) =>
    server()
      .post(`/admin/courses/${courseId}/sections`)
      .set(XHR)
      .set('Cookie', admin.cookie)
      .send({ title });
  /** Appends a section through the API and returns its id. */
  const newSection = async (courseId: string, title = 'Phần') => {
    const res = await addSection(courseId, title);
    expect(res.status).toBe(201);
    const sections = res.body.data.sections as Array<{ id: string }>;
    return sections[sections.length - 1].id;
  };
  const renameSection = (sectionId: string, body: object) =>
    server()
      .put(`/admin/course-sections/${sectionId}`)
      .set(XHR)
      .set('Cookie', admin.cookie)
      .send(body);
  const deleteSection = (sectionId: string) =>
    server().delete(`/admin/course-sections/${sectionId}`).set(XHR).set('Cookie', admin.cookie);
  const addLesson = (sectionId: string, body: object) =>
    server()
      .post(`/admin/course-sections/${sectionId}/lessons`)
      .set(XHR)
      .set('Cookie', admin.cookie)
      .send(body);
  /** Appends a lesson through the API and returns its id. */
  const newLesson = async (sectionId: string, body: object = { title: 'Bài' }) => {
    const res = await addLesson(sectionId, body);
    expect(res.status).toBe(201);
    const sections = res.body.data.sections as Array<{
      id: string;
      lessons: Array<{ id: string }>;
    }>;
    const lessons = sections.find((section) => section.id === sectionId)!.lessons;
    return lessons[lessons.length - 1].id;
  };
  const updateLesson = (lessonId: string, body: object) =>
    server()
      .put(`/admin/course-lessons/${lessonId}`)
      .set(XHR)
      .set('Cookie', admin.cookie)
      .send(body);
  const lessonAction = (lessonId: string, action: 'publish' | 'unpublish') =>
    server()
      .post(`/admin/course-lessons/${lessonId}/${action}`)
      .set(XHR)
      .set('Cookie', admin.cookie);
  const deleteLesson = (lessonId: string) =>
    server().delete(`/admin/course-lessons/${lessonId}`).set(XHR).set('Cookie', admin.cookie);
  const reorder = (courseId: string, body: object) =>
    server()
      .put(`/admin/courses/${courseId}/curriculum-order`)
      .set(XHR)
      .set('Cookie', admin.cookie)
      .send(body);
  type LessonBody = {
    id: string;
    title: string;
    status: string;
    videoId: string | null;
    updatedAt: string;
  };
  const lessonIn = (course: { sections: Array<{ lessons: LessonBody[] }> }, lessonId: string) =>
    course.sections.flatMap((section) => section.lessons).find((lesson) => lesson.id === lessonId)!;

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

  describe('sections', () => {
    it('appends sections in order (201) and returns the whole course', async () => {
      const courseId = await createdId();
      const first = await addSection(courseId, 'Phần 1');
      expect(first.status).toBe(201);
      const second = await addSection(courseId, '  Phần 2  ');
      expect(second.status).toBe(201);
      expect(second.body.data.sections).toEqual([
        { id: expect.stringMatching(UUID), title: 'Phần 1', position: 0, lessons: [] },
        { id: expect.stringMatching(UUID), title: 'Phần 2', position: 1, lessons: [] },
      ]);
      expect(second.body.data).toEqual(expect.objectContaining({ id: courseId, lessonCount: 0 }));
    });

    it('renames a section', async () => {
      const courseId = await createdId();
      const sectionId = await newSection(courseId, 'Cũ');
      const res = await renameSection(sectionId, { title: 'Mới' });
      expect(res.status).toBe(200);
      expect(res.body.data.sections).toEqual([
        { id: sectionId, title: 'Mới', position: 0, lessons: [] },
      ]);
    });

    it('deletes an empty section (204) and closes the gap in positions', async () => {
      const courseId = await createdId();
      const first = await newSection(courseId, 'Một');
      const second = await newSection(courseId, 'Hai');
      const res = await deleteSection(first);
      expect(res.status).toBe(204);
      expect(res.text).toBe('');
      expect((await get(courseId)).body.data.sections).toEqual([
        { id: second, title: 'Hai', position: 0, lessons: [] },
      ]);
    });

    it('refuses to delete a section holding a lesson (409 SECTION_NOT_EMPTY)', async () => {
      const courseId = await createdId();
      const sectionId = await newSection(courseId);
      await newLesson(sectionId);
      const res = await deleteSection(sectionId);
      expect(res.status).toBe(409);
      expect(res.body).toEqual(sectionNotEmpty);
    });

    it('gives 404 for an unknown course or section', async () => {
      for (const res of [
        await addSection(UNKNOWN_ID, 'Phần'),
        await renameSection(UNKNOWN_ID, { title: 'Phần' }),
        await deleteSection(UNKNOWN_ID),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(notFound);
      }
    });

    it.each([
      ['a NUL in the title (Review Focus 1)', { title: 'a\u0000' }, ['title', 'INVALID']],
      ['a whitespace-only title', { title: '\t \n' }, ['title', 'TOO_SHORT']],
      ['a 201-character title', { title: 'a'.repeat(201) }, ['title', 'TOO_LONG']],
      ['an unknown key', { title: 'Phần', position: 3 }, ['position', 'UNKNOWN_FIELD']],
    ] as const)('rejects %s on create and rename (400)', async (_case, body, field) => {
      const courseId = await createdId();
      const sectionId = await newSection(courseId);
      for (const res of [
        await server()
          .post(`/admin/courses/${courseId}/sections`)
          .set(XHR)
          .set('Cookie', admin.cookie)
          .send(body),
        await renameSection(sectionId, body),
      ]) {
        expect(res.status).toBe(400);
        expect(res.body).toEqual(invalid([...field]));
      }
    });

    it('rejects a malformed section id (400 INVALID_FORMAT)', async () => {
      const res = await renameSection('nope', { title: 'Phần' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual(invalid(['sectionId', 'INVALID_FORMAT']));
    });
  });

  describe('lessons', () => {
    it('creates draft lessons, appended in their section, with and without a video (201)', async () => {
      const courseId = await createdId();
      const sectionId = await newSection(courseId);
      const plain = await addLesson(sectionId, { title: ' Bài 1 ' });
      expect(plain.status).toBe(201);
      const withVideo = await addLesson(sectionId, {
        title: 'Bài 2',
        videoId: '76979871',
        privacyHash: 'a1B2c3',
        durationSeconds: 600,
      });
      expect(withVideo.status).toBe(201);
      expect(withVideo.body.data.sections[0].lessons).toEqual([
        {
          id: expect.stringMatching(UUID),
          title: 'Bài 1',
          position: 0,
          status: 'draft',
          videoId: null,
          privacyHash: null,
          durationSeconds: null,
          updatedAt: expect.stringMatching(ISO),
        },
        {
          id: expect.stringMatching(UUID),
          title: 'Bài 2',
          position: 1,
          status: 'draft',
          videoId: '76979871',
          privacyHash: 'a1B2c3',
          durationSeconds: 600,
          updatedAt: expect.stringMatching(ISO),
        },
      ]);
      expect(withVideo.body.data).toEqual(
        expect.objectContaining({ lessonCount: 2, publishedLessonCount: 0 }),
      );
    });

    it('replaces a lesson in full: omitted optional fields become null', async () => {
      const courseId = await createdId();
      const sectionId = await newSection(courseId);
      const lessonId = await newLesson(sectionId, {
        title: 'Bài',
        videoId: '1',
        privacyHash: 'abc',
        durationSeconds: 60,
      });
      const res = await updateLesson(lessonId, { title: 'Bài mới' });
      expect(res.status).toBe(200);
      expect(lessonIn(res.body.data, lessonId)).toEqual(
        expect.objectContaining({
          title: 'Bài mới',
          videoId: null,
          privacyHash: null,
          durationSeconds: null,
        }),
      );
    });

    it('refuses to publish a lesson without a video (409 LESSON_VIDEO_MISSING)', async () => {
      const courseId = await createdId();
      const lessonId = await newLesson(await newSection(courseId));
      const res = await lessonAction(lessonId, 'publish');
      expect(res.status).toBe(409);
      expect(res.body).toEqual(videoMissing);
    });

    it('publishes a lesson with a video, idempotently, and keeps its video required', async () => {
      const courseId = await createdId();
      const lessonId = await newLesson(await newSection(courseId), { title: 'Bài', videoId: '1' });
      const published = await lessonAction(lessonId, 'publish');
      expect(published.status).toBe(200);
      expect(lessonIn(published.body.data, lessonId).status).toBe('published');
      expect(published.body.data.publishedLessonCount).toBe(1);
      const again = await lessonAction(lessonId, 'publish');
      expect(again.status).toBe(200);
      expect(lessonIn(again.body.data, lessonId).updatedAt).toBe(
        lessonIn(published.body.data, lessonId).updatedAt,
      );

      const cleared = await updateLesson(lessonId, { title: 'Bài' });
      expect(cleared.status).toBe(409);
      expect(cleared.body).toEqual(videoMissing);
      expect(lessonIn((await get(courseId)).body.data, lessonId).videoId).toBe('1');

      // References stay editable on a published lesson (course spec §8.2).
      const changed = await updateLesson(lessonId, {
        title: 'Bài',
        videoId: '2',
        privacyHash: 'h',
      });
      expect(changed.status).toBe(200);
      expect(lessonIn(changed.body.data, lessonId)).toEqual(
        expect.objectContaining({ status: 'published', videoId: '2', privacyHash: 'h' }),
      );
    });

    it('refuses to unpublish the last published lesson of a published course only', async () => {
      const courseId = await createdId();
      const lessonId = await newLesson(await newSection(courseId), { title: 'Bài', videoId: '1' });
      await lessonAction(lessonId, 'publish');
      await courseAction(courseId, 'publish');

      const refused = await lessonAction(lessonId, 'unpublish');
      expect(refused.status).toBe(409);
      expect(refused.body).toEqual(needsLesson);

      await courseAction(courseId, 'unpublish');
      const allowed = await lessonAction(lessonId, 'unpublish');
      expect(allowed.status).toBe(200);
      expect(lessonIn(allowed.body.data, lessonId).status).toBe('draft');
      const again = await lessonAction(lessonId, 'unpublish');
      expect(again.status).toBe(200);
    });

    it('deletes only draft lessons (204; 409 LESSON_IS_PUBLISHED) and closes the gap', async () => {
      const courseId = await createdId();
      const sectionId = await newSection(courseId);
      const published = await newLesson(sectionId, { title: 'Đã đăng', videoId: '1' });
      const draft = await newLesson(sectionId, { title: 'Nháp' });
      const last = await newLesson(sectionId, { title: 'Cuối' });
      await lessonAction(published, 'publish');

      const refused = await deleteLesson(published);
      expect(refused.status).toBe(409);
      expect(refused.body).toEqual(lessonIsPublished);

      const deleted = await deleteLesson(draft);
      expect(deleted.status).toBe(204);
      expect(deleted.text).toBe('');
      const lessons = (await get(courseId)).body.data.sections[0].lessons as Array<{
        id: string;
        position: number;
      }>;
      expect(lessons.map(({ id, position }) => ({ id, position }))).toEqual([
        { id: published, position: 0 },
        { id: last, position: 1 },
      ]);
    });

    it('gives 404 for an unknown section or lesson', async () => {
      for (const res of [
        await addLesson(UNKNOWN_ID, { title: 'Bài' }),
        await updateLesson(UNKNOWN_ID, { title: 'Bài' }),
        await lessonAction(UNKNOWN_ID, 'publish'),
        await lessonAction(UNKNOWN_ID, 'unpublish'),
        await deleteLesson(UNKNOWN_ID),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(notFound);
      }
    });

    it.each([
      ['a privacy hash without a video id', { privacyHash: 'abc' }, [['privacyHash', 'INVALID']]],
      ['a video id with a letter', { videoId: '12a' }, [['videoId', 'INVALID_FORMAT']]],
      ['a 21-digit video id', { videoId: '1'.repeat(21) }, [['videoId', 'INVALID_FORMAT']]],
      ['a zero duration', { durationSeconds: 0 }, [['durationSeconds', 'TOO_SMALL']]],
      ['a negative duration', { durationSeconds: -1 }, [['durationSeconds', 'TOO_SMALL']]],
      ['a fractional duration', { durationSeconds: 1.5 }, [['durationSeconds', 'INVALID_TYPE']]],
      ['an explicit null video id', { videoId: null }, [['videoId', 'INVALID_TYPE']]],
      ['an unknown videoUrl', { videoUrl: 'https://vimeo.com/1' }, [['videoUrl', 'UNKNOWN_FIELD']]],
      ['a NUL in the title (Review Focus 1)', { title: '\u0000' }, [['title', 'INVALID']]],
      ['a whitespace-only title', { title: '　' }, [['title', 'TOO_SHORT']]],
      ['a 201-character title', { title: 'a'.repeat(201) }, [['title', 'TOO_LONG']]],
    ] as const)(
      'rejects %s on create and update (400, Review Focus 4)',
      async (_case, overrides, fields) => {
        const courseId = await createdId();
        const sectionId = await newSection(courseId);
        const lessonId = await newLesson(sectionId);
        for (const res of [
          await addLesson(sectionId, { title: 'Bài', ...overrides }),
          await updateLesson(lessonId, { title: 'Bài', ...overrides }),
        ]) {
          expect(res.status).toBe(400);
          expect(res.body).toEqual(invalid(...fields.map(([f, c]) => [f, c] as [string, string])));
        }
      },
    );

    it('rejects a malformed lesson id (400 INVALID_FORMAT)', async () => {
      const res = await lessonAction('nope', 'publish');
      expect(res.status).toBe(400);
      expect(res.body).toEqual(invalid(['lessonId', 'INVALID_FORMAT']));
    });
  });

  describe('curriculum order', () => {
    /** Sections A (l1, l2) and B (l3). */
    const curriculum = async () => {
      const courseId = await createdId();
      const a = await newSection(courseId, 'A');
      const b = await newSection(courseId, 'B');
      const l1 = await newLesson(a, { title: 'l1' });
      const l2 = await newLesson(a, { title: 'l2' });
      const l3 = await newLesson(b, { title: 'l3' });
      return { courseId, a, b, l1, l2, l3 };
    };
    /** `[sectionId, position, [lessonId, position][]]` in curriculum order. */
    const shape = (course: {
      sections: Array<{
        id: string;
        position: number;
        lessons: Array<{ id: string; position: number }>;
      }>;
    }) => course.sections.map((s) => [s.id, s.position, s.lessons.map((l) => [l.id, l.position])]);

    it('reorders sections, reorders lessons and moves a lesson across sections, keeping lesson ids', async () => {
      const { courseId, a, b, l1, l2, l3 } = await curriculum();

      const sections = await reorder(courseId, {
        sections: [
          { id: b, lessonIds: [l3] },
          { id: a, lessonIds: [l1, l2] },
        ],
      });
      expect(sections.status).toBe(200);
      expect(shape(sections.body.data)).toEqual([
        [b, 0, [[l3, 0]]],
        [
          a,
          1,
          [
            [l1, 0],
            [l2, 1],
          ],
        ],
      ]);

      const lessons = await reorder(courseId, {
        sections: [
          { id: b, lessonIds: [l3] },
          { id: a, lessonIds: [l2, l1] },
        ],
      });
      expect(shape(lessons.body.data)).toEqual([
        [b, 0, [[l3, 0]]],
        [
          a,
          1,
          [
            [l2, 0],
            [l1, 1],
          ],
        ],
      ]);

      const moved = await reorder(courseId, {
        sections: [
          { id: a, lessonIds: [l2] },
          { id: b, lessonIds: [l1, l3] },
        ],
      });
      expect(moved.status).toBe(200);
      expect(shape(moved.body.data)).toEqual([
        [a, 0, [[l2, 0]]],
        [
          b,
          1,
          [
            [l1, 0],
            [l3, 1],
          ],
        ],
      ]);
      expect(lessonIn(moved.body.data, l1).title).toBe('l1');
    });

    it('refuses an incomplete or foreign order (409 CURRICULUM_ORDER_MISMATCH) and changes nothing (Review Focus 3)', async () => {
      const { courseId, a, b, l1, l2, l3 } = await curriculum();
      const other = await createdId(saveCourse({ slug: 'khac' }));
      const foreignSection = await newSection(other);
      const foreignLesson = await newLesson(foreignSection);
      const before = (await get(courseId)).body.data;

      for (const sections of [
        [{ id: a, lessonIds: [l1, l2, l3] }],
        [
          { id: a, lessonIds: [l1] },
          { id: b, lessonIds: [l3] },
        ],
        [
          { id: a, lessonIds: [l1, l2, l1] },
          { id: b, lessonIds: [l3] },
        ],
        [
          { id: a, lessonIds: [l1, l2] },
          { id: a, lessonIds: [l3] },
        ],
        [
          { id: a, lessonIds: [l1, l2, foreignLesson] },
          { id: b, lessonIds: [l3] },
        ],
        [
          { id: a, lessonIds: [l1, l2] },
          { id: b, lessonIds: [l3] },
          { id: foreignSection, lessonIds: [] },
        ],
        [
          { id: a, lessonIds: [l1, l2] },
          { id: foreignSection, lessonIds: [l3] },
        ],
      ]) {
        const res = await reorder(courseId, { sections });
        expect(res.status).toBe(409);
        expect(res.body).toEqual(orderMismatch);
      }
      expect((await get(courseId)).body.data).toEqual(before);
    });

    it('gives 404 for an unknown course and 400 for malformed ids', async () => {
      const missing = await reorder(UNKNOWN_ID, { sections: [] });
      expect(missing.status).toBe(404);
      expect(missing.body).toEqual(notFound);
      const courseId = await createdId();
      const malformed = await reorder(courseId, { sections: [{ id: 'x', lessonIds: [] }] });
      expect(malformed.status).toBe(400);
      expect(malformed.body).toEqual(invalid(['sections.0.id', 'INVALID_FORMAT']));
    });
  });

  describe('course updatedAt: the latest meaningful change to the course or its curriculum', () => {
    // A fixed past instant written directly, so "moved" and "unchanged" need no clock comparison.
    const PAST = '2000-01-01T00:00:00.000Z';
    const backdate = (courseId: string) =>
      db.query(`UPDATE courses SET updated_at = $2 WHERE id = $1`, [courseId, PAST]);
    const courseUpdatedAt = async (courseId: string) =>
      ((await get(courseId)).body.data as { updatedAt: string }).updatedAt;

    /** A published course: section S (draft lesson d with a video, published lesson p) and an empty section E. */
    const fixture = async () => {
      const courseId = await createdId();
      const sectionId = await newSection(courseId, 'S');
      const emptyId = await newSection(courseId, 'E');
      const draftId = await newLesson(sectionId, { title: 'd', videoId: '76979871' });
      const publishedId = await newLesson(sectionId, {
        title: 'p',
        videoId: '76979872',
        durationSeconds: 60,
      });
      expect((await lessonAction(publishedId, 'publish')).status).toBe(200);
      expect((await courseAction(courseId, 'publish')).status).toBe(200);
      return { courseId, sectionId, emptyId, draftId, publishedId };
    };
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    type Case = {
      name: string;
      prepare?: (f: Fixture) => Promise<unknown>;
      act: (f: Fixture) => Promise<request.Response>;
      status: number;
    };
    const order = (f: Fixture, lessonIds: string[]) => ({
      sections: [
        { id: f.sectionId, lessonIds },
        { id: f.emptyId, lessonIds: [] },
      ],
    });
    const draftLesson = (overrides: object = {}) => ({
      title: 'd',
      videoId: '76979871',
      ...overrides,
    });

    const moving: Case[] = [
      {
        name: 'course metadata change',
        act: (f) => update(f.courseId, saveCourse({ title: 'Tên mới' })),
        status: 200,
      },
      {
        name: 'course publish',
        prepare: (f) => courseAction(f.courseId, 'unpublish'),
        act: (f) => courseAction(f.courseId, 'publish'),
        status: 200,
      },
      { name: 'course unpublish', act: (f) => courseAction(f.courseId, 'unpublish'), status: 200 },
      { name: 'section create', act: (f) => addSection(f.courseId, 'T'), status: 201 },
      {
        name: 'section rename',
        act: (f) => renameSection(f.sectionId, { title: 'S2' }),
        status: 200,
      },
      { name: 'section delete', act: (f) => deleteSection(f.emptyId), status: 204 },
      { name: 'lesson create', act: (f) => addLesson(f.sectionId, { title: 'n' }), status: 201 },
      {
        name: 'lesson title edit',
        act: (f) => updateLesson(f.draftId, draftLesson({ title: 'd2' })),
        status: 200,
      },
      {
        name: 'lesson video change',
        act: (f) => updateLesson(f.draftId, draftLesson({ videoId: '76979873' })),
        status: 200,
      },
      {
        name: 'lesson duration change',
        act: (f) => updateLesson(f.draftId, draftLesson({ durationSeconds: 90 })),
        status: 200,
      },
      {
        name: 'lesson privacy hash change',
        act: (f) => updateLesson(f.draftId, draftLesson({ privacyHash: 'abc123' })),
        status: 200,
      },
      { name: 'lesson publish', act: (f) => lessonAction(f.draftId, 'publish'), status: 200 },
      {
        name: 'lesson unpublish',
        prepare: (f) => lessonAction(f.draftId, 'publish'),
        act: (f) => lessonAction(f.publishedId, 'unpublish'),
        status: 200,
      },
      { name: 'lesson delete', act: (f) => deleteLesson(f.draftId), status: 204 },
      {
        name: 'curriculum order change',
        act: (f) => reorder(f.courseId, order(f, [f.publishedId, f.draftId])),
        status: 200,
      },
      {
        name: 'section-only reorder',
        act: (f) =>
          reorder(f.courseId, {
            sections: [
              { id: f.emptyId, lessonIds: [] },
              { id: f.sectionId, lessonIds: [f.draftId, f.publishedId] },
            ],
          }),
        status: 200,
      },
      {
        name: 'lesson move to another section',
        act: (f) =>
          reorder(f.courseId, {
            sections: [
              { id: f.sectionId, lessonIds: [f.publishedId] },
              { id: f.emptyId, lessonIds: [f.draftId] },
            ],
          }),
        status: 200,
      },
    ];
    const unchanged: Case[] = [
      {
        name: 'identical course metadata',
        act: (f) => update(f.courseId, saveCourse()),
        status: 200,
      },
      {
        name: 'repeated course publish',
        act: (f) => courseAction(f.courseId, 'publish'),
        status: 200,
      },
      {
        name: 'repeated course unpublish',
        prepare: (f) => courseAction(f.courseId, 'unpublish'),
        act: (f) => courseAction(f.courseId, 'unpublish'),
        status: 200,
      },
      {
        name: 'identical section title',
        act: (f) => renameSection(f.sectionId, { title: 'S' }),
        status: 200,
      },
      { name: 'identical lesson', act: (f) => updateLesson(f.draftId, draftLesson()), status: 200 },
      {
        name: 'repeated lesson publish',
        act: (f) => lessonAction(f.publishedId, 'publish'),
        status: 200,
      },
      {
        name: 'repeated lesson unpublish',
        act: (f) => lessonAction(f.draftId, 'unpublish'),
        status: 200,
      },
      {
        name: 'identical curriculum order',
        act: (f) => reorder(f.courseId, order(f, [f.draftId, f.publishedId])),
        status: 200,
      },
      { name: 'refused change (409)', act: (f) => deleteLesson(f.publishedId), status: 409 },
      {
        name: 'refused video removal from a published lesson (409)',
        act: (f) => updateLesson(f.publishedId, { title: 'p' }),
        status: 409,
      },
    ];

    it.each(moving)('moves on a $name', async ({ prepare, act, status }) => {
      const f = await fixture();
      await prepare?.(f);
      await backdate(f.courseId);
      expect((await act(f)).status).toBe(status);
      expect(await courseUpdatedAt(f.courseId)).not.toBe(PAST);
    });

    it.each(unchanged)('stays on a $name', async ({ prepare, act, status }) => {
      const f = await fixture();
      await prepare?.(f);
      await backdate(f.courseId);
      expect((await act(f)).status).toBe(status);
      expect(await courseUpdatedAt(f.courseId)).toBe(PAST);
    });
  });

  describe('concurrency (spec §18 R1–R4)', () => {
    // Each outcome must match some serial order of the two requests (lock rule L1).
    const TRIALS = 15;

    it('R1: course publish ∥ unpublish of its only published lesson → exactly one 409, never a course without published lessons', async () => {
      for (let trial = 0; trial < TRIALS; trial++) {
        const courseId = await createdId(saveCourse({ slug: `r1-${trial}` }));
        const lessonId = await newLesson(await newSection(courseId), {
          title: 'Bài',
          videoId: '1',
        });
        await lessonAction(lessonId, 'publish');
        const [course, lesson] = await Promise.all([
          courseAction(courseId, 'publish'),
          lessonAction(lessonId, 'unpublish'),
        ]);
        expect([course.status, lesson.status].sort((a, b) => a - b)).toEqual([200, 409]);
        const final = (await get(courseId)).body.data as {
          status: string;
          publishedLessonCount: number;
        };
        if (final.status === 'published')
          expect(final.publishedLessonCount).toBeGreaterThanOrEqual(1);
      }
    });

    it('R2: two concurrent unpublishes of a published course’s two published lessons → one 200, one 409', async () => {
      for (let trial = 0; trial < TRIALS; trial++) {
        const courseId = await createdId(saveCourse({ slug: `r2-${trial}` }));
        const sectionId = await newSection(courseId);
        const x = await newLesson(sectionId, { title: 'x', videoId: '1' });
        const y = await newLesson(sectionId, { title: 'y', videoId: '2' });
        await lessonAction(x, 'publish');
        await lessonAction(y, 'publish');
        await courseAction(courseId, 'publish');
        const results = await Promise.all([
          lessonAction(x, 'unpublish'),
          lessonAction(y, 'unpublish'),
        ]);
        expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 409]);
        expect((await get(courseId)).body.data.publishedLessonCount).toBe(1);
      }
    });

    it('R3: delete an empty section ∥ an order moving a lesson into it → a serial outcome, never 500', async () => {
      for (let trial = 0; trial < TRIALS; trial++) {
        const courseId = await createdId(saveCourse({ slug: `r3-${trial}` }));
        const t = await newSection(courseId, 'T');
        const s = await newSection(courseId, 'S');
        const l = await newLesson(t);
        const [deleted, ordered] = await Promise.all([
          deleteSection(s),
          reorder(courseId, {
            sections: [
              { id: t, lessonIds: [] },
              { id: s, lessonIds: [l] },
            ],
          }),
        ]);
        const outcome = [
          deleted.status,
          deleted.body?.error?.code,
          ordered.status,
          ordered.body?.error?.code,
        ];
        expect([
          [204, undefined, 409, 'CURRICULUM_ORDER_MISMATCH'],
          [409, 'SECTION_NOT_EMPTY', 200, undefined],
        ]).toContainEqual(outcome);
      }
    });

    it('R4: lesson create ∥ an order of the old curriculum → the order applies with the new lesson last, or 409; positions stay 0..n-1', async () => {
      for (let trial = 0; trial < TRIALS; trial++) {
        const courseId = await createdId(saveCourse({ slug: `r4-${trial}` }));
        const sectionId = await newSection(courseId);
        const old = await newLesson(sectionId, { title: 'cũ' });
        const [added, ordered] = await Promise.all([
          addLesson(sectionId, { title: 'mới' }),
          reorder(courseId, { sections: [{ id: sectionId, lessonIds: [old] }] }),
        ]);
        expect(added.status).toBe(201);
        if (ordered.status === 200) {
          const lessons = (await get(courseId)).body.data.sections[0].lessons as Array<{
            title: string;
          }>;
          expect(lessons.map((lesson) => lesson.title)).toEqual(['cũ', 'mới']);
        } else {
          expect(ordered.status).toBe(409);
          expect(ordered.body).toEqual(orderMismatch);
        }
        const positions = await db.query<{ section_id: string; positions: number[] }[]>(
          `SELECT section_id, array_agg(position ORDER BY position) AS positions FROM course_lessons GROUP BY section_id`,
        );
        for (const row of positions) expect(row.positions).toEqual(row.positions.map((_p, i) => i));
      }
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
      { method: 'post', path: `/admin/courses/${UNKNOWN_ID}/sections`, body: { title: 'Phần' } },
      { method: 'put', path: `/admin/course-sections/${UNKNOWN_ID}`, body: { title: 'Phần' } },
      { method: 'delete', path: `/admin/course-sections/${UNKNOWN_ID}` },
      {
        method: 'put',
        path: `/admin/courses/${UNKNOWN_ID}/curriculum-order`,
        body: { sections: [] },
      },
      {
        method: 'post',
        path: `/admin/course-sections/${UNKNOWN_ID}/lessons`,
        body: { title: 'Bài' },
      },
      { method: 'put', path: `/admin/course-lessons/${UNKNOWN_ID}`, body: { title: 'Bài' } },
      { method: 'post', path: `/admin/course-lessons/${UNKNOWN_ID}/publish` },
      { method: 'post', path: `/admin/course-lessons/${UNKNOWN_ID}/unpublish` },
      { method: 'delete', path: `/admin/course-lessons/${UNKNOWN_ID}` },
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
