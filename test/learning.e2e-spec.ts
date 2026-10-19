import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { signInAs, type TestUser, XHR } from './support/auth.js';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const UNKNOWN_ID = '01900000-0000-7000-8000-000000000000';

const envelope = (code: string, message: string, details: object = {}) => ({
  data: null,
  error: { code, message, details },
});
const unauthenticated = envelope('UNAUTHENTICATED', 'You need to sign in.');
const notFound = envelope('NOT_FOUND', 'The requested resource was not found.');
const accessRequired = envelope('COURSE_ACCESS_REQUIRED', 'You need access to this course.');

/** Every key anywhere in a JSON value. */
const keysOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(keysOf)
    : value !== null && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
      : [];

describe('Learner courses and gated playback (/learn/courses…)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let admin: { user: TestUser; cookie: string };
  let learner: { user: TestUser; cookie: string };
  /** Published course C: section A (published l1, draft d, published l2), B (published l3, with a hash), Z (draft only). */
  let c: { id: string; a: string; b: string; l1: string; d: string; l2: string; l3: string };
  /** Published course C2 with one published lesson x; draft course C3 with a published lesson y. */
  let c2: { id: string; x: string };
  let c3: { id: string; y: string };

  const insert = async (table: string, columns: Record<string, unknown>) => {
    const names = Object.keys(columns);
    const [{ id }] = await db.query<{ id: string }[]>(
      `INSERT INTO ${table} (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(columns),
    );
    return id;
  };
  const course = (slug: string, publishedAt: string | null) =>
    insert('courses', {
      slug,
      title: `Khóa ${slug}`,
      summary: `Tóm tắt ${slug}`,
      status: publishedAt ? 'published' : 'draft',
      published_at: publishedAt,
    });
  const section = (courseId: string, title: string, position: number) =>
    insert('course_sections', { course_id: courseId, title, position });
  const lesson = (sectionId: string, title: string, position: number, extra: object = {}) =>
    insert('course_lessons', {
      section_id: sectionId,
      title,
      position,
      status: 'published',
      vimeo_video_id: '76979871',
      ...extra,
    });
  const grantDirect = (userId: string, courseId: string) =>
    insert('course_access_grants', {
      user_id: userId,
      course_id: courseId,
      source: 'admin',
      granted_by_user_id: admin.user.id,
    });

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    admin = await signInAs(app, { role: 'admin' });
    learner = await signInAs(app);
    const id = await course('c', '2026-10-01T00:00:00.000Z');
    const a = await section(id, 'A', 0);
    const b = await section(id, 'B', 1);
    const z = await section(id, 'Z', 2);
    const l1 = await lesson(a, 'l1', 0, { vimeo_video_id: '111', duration_seconds: 600 });
    const d = await lesson(a, 'd', 1, { status: 'draft', vimeo_video_id: '222' });
    const l2 = await lesson(a, 'l2', 2, { vimeo_video_id: '333' });
    const l3 = await lesson(b, 'l3', 0, {
      vimeo_video_id: '444',
      vimeo_hash: 'abc123',
      duration_seconds: 300,
    });
    await lesson(z, 'z', 0, { status: 'draft', vimeo_video_id: null });
    c = { id, a, b, l1, d, l2, l3 };
    const c2Id = await course('c2', '2026-10-02T00:00:00.000Z');
    c2 = { id: c2Id, x: await lesson(await section(c2Id, 'X', 0), 'x', 0) };
    const c3Id = await course('c3', null);
    c3 = { id: c3Id, y: await lesson(await section(c3Id, 'Y', 0), 'y', 0) };
  });
  afterAll(async () => {
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const learn = (path: string, cookie = learner.cookie) =>
    server().get(`/learn/courses${path}`).set('Cookie', cookie);
  const adminAction = (path: string, method: 'put' | 'delete' | 'post') =>
    server()[method](path).set(XHR).set('Cookie', admin.cookie);

  const summaryOf = (slug: string, id: string, publishedAt: string) => ({
    id,
    slug,
    title: `Khóa ${slug}`,
    summary: `Tóm tắt ${slug}`,
    publishedAt,
  });

  describe('GET /learn/courses', () => {
    it('lists only published courses with an active grant, newest first, with published-lesson counts', async () => {
      await grantDirect(learner.user.id, c.id);
      await grantDirect(learner.user.id, c2.id);
      await grantDirect(learner.user.id, c3.id); // a draft course is never listed (OD-2)
      const res = await learn('');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toEqual({
        data: [
          { course: summaryOf('c2', c2.id, '2026-10-02T00:00:00.000Z'), totalLessons: 1 },
          { course: summaryOf('c', c.id, '2026-10-01T00:00:00.000Z'), totalLessons: 3 },
        ],
      });
    });

    it('is empty without grants, also for an admin (no implicit learner access)', async () => {
      expect((await learn('')).body).toEqual({ data: [] });
      expect((await learn('', admin.cookie)).body).toEqual({ data: [] });
    });
  });

  describe('GET /learn/courses/:slug', () => {
    it('returns the learner curriculum: published lessons only, empty sections omitted, no video field', async () => {
      await grantDirect(learner.user.id, c.id);
      const res = await learn('/c');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toEqual({
        data: {
          course: summaryOf('c', c.id, '2026-10-01T00:00:00.000Z'),
          sections: [
            {
              id: c.a,
              title: 'A',
              lessons: [
                { id: c.l1, title: 'l1', durationSeconds: 600 },
                { id: c.l2, title: 'l2', durationSeconds: null },
              ],
            },
            { id: c.b, title: 'B', lessons: [{ id: c.l3, title: 'l3', durationSeconds: 300 }] },
          ],
        },
      });
      const keys = keysOf(res.body);
      for (const key of ['videoId', 'privacyHash', 'video']) expect(keys).not.toContain(key);
      expect(keys.some((key) => key.toLowerCase().includes('vimeo'))).toBe(false);
    });

    it('refuses without a grant (403 COURSE_ACCESS_REQUIRED), also for an admin', async () => {
      expect((await learn('/c')).body).toEqual(accessRequired);
      expect((await learn('/c', admin.cookie)).body).toEqual(accessRequired);
    });

    it('gives 404 for a draft course even with a grant, and for unknown or impossible slugs', async () => {
      await grantDirect(learner.user.id, c3.id);
      for (const slug of ['/c3', '/missing', '/UPPER', '/a%00b']) {
        expect((await learn(slug)).body).toEqual(notFound);
      }
    });
  });

  describe('GET /learn/courses/:slug/lessons/:lessonId', () => {
    it('returns the playback reference and the neighbours across sections, skipping the draft', async () => {
      await grantDirect(learner.user.id, c.id);
      const l2 = await learn(`/c/lessons/${c.l2}`);
      expect(l2.status).toBe(200);
      expect(l2.headers['cache-control']).toBe('no-store');
      expect(l2.body).toEqual({
        data: {
          id: c.l2,
          title: 'l2',
          sectionTitle: 'A',
          durationSeconds: null,
          video: { provider: 'vimeo', videoId: '333', privacyHash: null },
          previousLessonId: c.l1,
          nextLessonId: c.l3,
        },
      });
      expect((await learn(`/c/lessons/${c.l3}`)).body).toEqual({
        data: {
          id: c.l3,
          title: 'l3',
          sectionTitle: 'B',
          durationSeconds: 300,
          video: { provider: 'vimeo', videoId: '444', privacyHash: 'abc123' },
          previousLessonId: c.l2,
          nextLessonId: null,
        },
      });
    });

    it('gives 404 with a grant for a draft lesson, a lesson of another course, an unknown lesson and a draft course', async () => {
      await grantDirect(learner.user.id, c.id);
      await grantDirect(learner.user.id, c3.id);
      for (const path of [
        `/c/lessons/${c.d}`,
        `/c/lessons/${c2.x}`,
        `/c/lessons/${UNKNOWN_ID}`,
        `/c3/lessons/${c3.y}`,
        `/missing/lessons/${c.l1}`,
      ]) {
        expect((await learn(path)).body).toEqual(notFound);
      }
    });

    it('checks existence before access: without a grant a draft lesson is 404, a published one 403', async () => {
      expect((await learn(`/c/lessons/${c.d}`)).body).toEqual(notFound);
      expect((await learn(`/c/lessons/${c.l1}`)).body).toEqual(accessRequired);
      expect((await learn(`/c/lessons/${c.l1}`, admin.cookie)).body).toEqual(accessRequired);
    });

    it('rejects a malformed lesson id (400 INVALID_FORMAT)', async () => {
      expect((await learn('/c/lessons/x')).body).toEqual(
        envelope('VALIDATION_FAILED', 'The request is invalid.', {
          fields: [
            {
              field: 'lessonId',
              message: 'This value has an invalid format.',
              code: 'INVALID_FORMAT',
            },
          ],
        }),
      );
    });
  });

  describe('revocation and publication (CP6, OD-4)', () => {
    it('refuses the next request after a revocation, and allows it again after a new grant', async () => {
      const access = `/admin/courses/${c.id}/access/${learner.user.id}`;
      expect((await adminAction(access, 'put')).status).toBe(200);
      expect((await learn(`/c/lessons/${c.l1}`)).status).toBe(200);
      expect((await adminAction(access, 'delete')).status).toBe(204);
      expect((await learn(`/c/lessons/${c.l1}`)).body).toEqual(accessRequired);
      expect((await learn('/c')).body).toEqual(accessRequired);
      expect((await learn('')).body).toEqual({ data: [] });
      expect((await adminAction(access, 'put')).status).toBe(200);
      expect((await learn(`/c/lessons/${c.l1}`)).status).toBe(200);
    });

    it('hides an unpublished course from its granted learner, and brings it back on republish', async () => {
      await grantDirect(learner.user.id, c.id);
      expect((await adminAction(`/admin/courses/${c.id}/unpublish`, 'post')).status).toBe(200);
      expect((await learn('')).body).toEqual({ data: [] });
      expect((await learn('/c')).body).toEqual(notFound);
      expect((await learn(`/c/lessons/${c.l1}`)).body).toEqual(notFound);
      expect((await adminAction(`/admin/courses/${c.id}/publish`, 'post')).status).toBe(200);
      expect((await learn('')).body.data).toHaveLength(1);
      expect((await learn(`/c/lessons/${c.l1}`)).status).toBe(200);
    });
  });

  it('needs a session on every learner route (401)', async () => {
    for (const path of ['', '/c', `/c/lessons/${c.l1}`]) {
      expect((await server().get(`/learn/courses${path}`)).body).toEqual(unauthenticated);
    }
  });
});
