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
const invalidFormat = (field: string) =>
  envelope('VALIDATION_FAILED', 'The request is invalid.', {
    fields: [{ field, message: 'This value has an invalid format.', code: 'INVALID_FORMAT' }],
  });

describe('Admin course access (/admin/courses/:courseId/access…)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let admin: { user: TestUser; cookie: string };
  let learner: { user: TestUser; cookie: string };
  let courseId: string;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    admin = await signInAs(app, { role: 'admin', displayName: 'Xuân' });
    learner = await signInAs(app, {
      displayName: 'Học viên',
      avatarUrl: 'https://lh3.googleusercontent.com/a/hv',
    });
    courseId = await insertCourse('workflow-edit-video-youtube');
  });
  afterAll(async () => {
    await app.close();
  });

  /** A draft course, written directly (independent of the routes under test). */
  const insertCourse = async (slug: string) => {
    const [{ id }] = await db.query<{ id: string }[]>(
      `INSERT INTO courses (slug, title, summary) VALUES ($1, 'Khóa', 'Tóm tắt') RETURNING id`,
      [slug],
    );
    return id;
  };
  const server = () => request(app.getHttpServer());
  const grant = (course: string, userId: string, cookie = admin.cookie) =>
    server().put(`/admin/courses/${course}/access/${userId}`).set(XHR).set('Cookie', cookie);
  const revoke = (course: string, userId: string, cookie = admin.cookie) =>
    server().delete(`/admin/courses/${course}/access/${userId}`).set(XHR).set('Cookie', cookie);
  const list = (course: string, cookie = admin.cookie) =>
    server().get(`/admin/courses/${course}/access-grants`).set('Cookie', cookie);
  const activeGrantIds = async (course = courseId, userId = learner.user.id) =>
    (
      await db.query<{ id: string }[]>(
        `SELECT id FROM course_access_grants WHERE course_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [course, userId],
      )
    ).map((row) => row.id);

  const profile = (user: TestUser) => ({
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  });

  describe('grant (PUT)', () => {
    it('grants a draft course to an existing user and returns the active grant (200)', async () => {
      const res = await grant(courseId, learner.user.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: {
          id: expect.stringMatching(UUID),
          user: profile(learner.user),
          source: 'admin',
          grantedAt: expect.stringMatching(ISO),
          grantedBy: profile(admin.user),
          revokedAt: null,
          revokedBy: null,
        },
      });
    });

    it('is idempotent: a repeat returns the same grant (id, grantedAt) and creates no row', async () => {
      const first = await grant(courseId, learner.user.id);
      const again = await grant(courseId, learner.user.id);
      expect(again.status).toBe(200);
      expect(again.body).toEqual(first.body);
      expect(await activeGrantIds()).toEqual([first.body.data.id]);
    });

    it('lets an admin grant themselves (OD-6)', async () => {
      const res = await grant(courseId, admin.user.id);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(
        expect.objectContaining({ user: profile(admin.user), grantedBy: profile(admin.user) }),
      );
    });

    it('gives 404 for an unknown user or course (FK translated), never 500', async () => {
      expect((await grant(courseId, UNKNOWN_ID)).body).toEqual(notFound);
      expect((await grant(UNKNOWN_ID, learner.user.id)).body).toEqual(notFound);
      expect((await grant(UNKNOWN_ID, UNKNOWN_ID)).status).toBe(404);
    });

    it('rejects malformed ids (400 INVALID_FORMAT)', async () => {
      expect((await grant('x', learner.user.id)).body).toEqual(invalidFormat('courseId'));
      expect((await grant(courseId, 'x')).body).toEqual(invalidFormat('userId'));
    });
  });

  describe('revoke (DELETE) and restore', () => {
    it('revokes (204, empty body), idempotently, and also for a user never granted', async () => {
      await grant(courseId, learner.user.id);
      const res = await revoke(courseId, learner.user.id);
      expect(res.status).toBe(204);
      expect(res.text).toBe('');
      expect(await activeGrantIds()).toEqual([]);
      expect((await revoke(courseId, learner.user.id)).status).toBe(204);
      expect((await revoke(courseId, UNKNOWN_ID)).status).toBe(204);
    });

    it('restores access with a new grant; the history lists both, newest first', async () => {
      const first = (await grant(courseId, learner.user.id)).body.data as { id: string };
      await revoke(courseId, learner.user.id);
      const second = (await grant(courseId, learner.user.id)).body.data as { id: string };
      expect(second.id).not.toBe(first.id);

      const res = await list(courseId);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: [
          {
            id: second.id,
            user: profile(learner.user),
            source: 'admin',
            grantedAt: expect.stringMatching(ISO),
            grantedBy: profile(admin.user),
            revokedAt: null,
            revokedBy: null,
          },
          {
            id: first.id,
            user: profile(learner.user),
            source: 'admin',
            grantedAt: expect.stringMatching(ISO),
            grantedBy: profile(admin.user),
            revokedAt: expect.stringMatching(ISO),
            revokedBy: profile(admin.user),
          },
        ],
      });
      expect(JSON.stringify(res.body)).not.toContain('email');
      expect(JSON.stringify(res.body)).not.toContain('@example.test');
    });

    it('gives 404 for an unknown course on revoke and on the list; an empty list for a course without grants', async () => {
      expect((await revoke(UNKNOWN_ID, learner.user.id)).body).toEqual(notFound);
      expect((await list(UNKNOWN_ID)).body).toEqual(notFound);
      expect((await list(courseId)).body).toEqual({ data: [] });
      expect((await list('x')).body).toEqual(invalidFormat('courseId'));
      expect((await revoke(courseId, 'x')).body).toEqual(invalidFormat('userId'));
    });
  });

  describe('authorization', () => {
    const routes = (cookie?: string) => {
      const withCookie = (req: request.Test) => (cookie ? req.set('Cookie', cookie) : req);
      return [
        withCookie(server().get(`/admin/courses/${courseId}/access-grants`)),
        withCookie(server().put(`/admin/courses/${courseId}/access/${learner.user.id}`).set(XHR)),
        withCookie(
          server().delete(`/admin/courses/${courseId}/access/${learner.user.id}`).set(XHR),
        ),
      ];
    };

    it('needs a session (401)', async () => {
      for (const res of await Promise.all(routes())) expect(res.body).toEqual(unauthenticated);
    });

    it('refuses users and editors (403)', async () => {
      const editor = await signInAs(app, { role: 'editor' });
      for (const cookie of [learner.cookie, editor.cookie]) {
        for (const res of await Promise.all(routes(cookie))) expect(res.body).toEqual(forbidden);
      }
    });

    it('needs the CSRF header on writes, even for an admin (403)', async () => {
      const put = await server()
        .put(`/admin/courses/${courseId}/access/${learner.user.id}`)
        .set('Cookie', admin.cookie);
      const del = await server()
        .delete(`/admin/courses/${courseId}/access/${learner.user.id}`)
        .set('Cookie', admin.cookie);
      expect([put.status, del.status]).toEqual([403, 403]);
      expect(await activeGrantIds()).toEqual([]);
    });
  });

  describe('concurrency (spec §18 R5, R5b, R6)', () => {
    const TRIALS = 15;

    it('R5: two concurrent grants → both 200 with the same id, one active row', async () => {
      for (let trial = 0; trial < TRIALS; trial++) {
        const course = await insertCourse(`r5-${trial}`);
        const results = await Promise.all([
          grant(course, learner.user.id),
          grant(course, learner.user.id),
        ]);
        expect(results.map((r) => r.status)).toEqual([200, 200]);
        expect(results[0].body.data.id).toBe(results[1].body.data.id);
        expect(await activeGrantIds(course)).toEqual([results[0].body.data.id]);
      }
    });

    it('R5b: grant ∥ revoke from an active grant G → 200 and 204 in a serial order, never 500', async () => {
      for (let trial = 0; trial < TRIALS; trial++) {
        const course = await insertCourse(`r5b-${trial}`);
        const g = (await grant(course, learner.user.id)).body.data.id as string;
        const [granted, revoked] = await Promise.all([
          grant(course, learner.user.id),
          revoke(course, learner.user.id),
        ]);
        expect([granted.status, revoked.status]).toEqual([200, 204]);
        const returned = granted.body.data.id as string;
        const [{ revoked_at }] = await db.query<{ revoked_at: Date | null }[]>(
          `SELECT revoked_at FROM course_access_grants WHERE id = $1`,
          [g],
        );
        expect(revoked_at).toBeInstanceOf(Date); // G is revoked in both serial orders
        // Grant first → it returned G, then the revoke closed G. Revoke first → a new active grant.
        expect(await activeGrantIds(course)).toEqual(returned === g ? [] : [returned]);
      }
    });

    it('R6: grant ∥ a slug change ∥ a lesson publish on the same course → all complete, no 500', async () => {
      for (let trial = 0; trial < TRIALS; trial++) {
        const course = await insertCourse(`r6-${trial}`);
        const [{ id: sectionId }] = await db.query<{ id: string }[]>(
          `INSERT INTO course_sections (course_id, title, position) VALUES ($1, 'Phần', 0) RETURNING id`,
          [course],
        );
        const [{ id: lessonId }] = await db.query<{ id: string }[]>(
          `INSERT INTO course_lessons (section_id, title, position, vimeo_video_id) VALUES ($1, 'Bài', 0, '76979871') RETURNING id`,
          [sectionId],
        );
        const results = await Promise.all([
          grant(course, learner.user.id),
          server()
            .put(`/admin/courses/${course}`)
            .set(XHR)
            .set('Cookie', admin.cookie)
            .send({ slug: `r6-${trial}-moi`, title: 'Khóa', summary: 'Tóm tắt' }),
          server()
            .post(`/admin/course-lessons/${lessonId}/publish`)
            .set(XHR)
            .set('Cookie', admin.cookie),
        ]);
        expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
        expect(await activeGrantIds(course)).toHaveLength(1);
      }
    });
  });
});
