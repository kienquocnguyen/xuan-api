import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { signInAs, type TestUser, XHR } from './support/auth.js';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const envelope = (code: string, message: string, details: object = {}) => ({
  data: null,
  error: { code, message, details },
});
const unauthenticated = envelope('UNAUTHENTICATED', 'You need to sign in.');
const notFound = envelope('NOT_FOUND', 'The requested resource was not found.');
const accessRequired = envelope('COURSE_ACCESS_REQUIRED', 'You need access to this course.');
const FIELD_MESSAGES: Record<string, string> = {
  REQUIRED: 'This field is required.',
  INVALID_TYPE: 'This value has the wrong type.',
  TOO_SMALL: 'This value is too small.',
  TOO_LARGE: 'This value is too large.',
  UNKNOWN_FIELD: 'This field is not allowed.',
  INVALID: 'This value is invalid.',
};
const invalid = (field: string, code: string) =>
  envelope('VALIDATION_FAILED', 'The request is invalid.', {
    fields: [{ field, message: FIELD_MESSAGES[code], code }],
  });

type Row = {
  id: string;
  user_id: string;
  lesson_id: string;
  position_seconds: number;
  completed_at: Date | null;
  last_watched_at: Date;
};

describe('Learner progress writes (PUT /learn/courses/:slug/lessons/:lessonId/progress)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let admin: { user: TestUser; cookie: string };
  let learner: { user: TestUser; cookie: string };
  /** Published course c: section A (l1 600 s, l2 without duration, draft d), B (l3). Published c2 with x; draft c3 with y. */
  let c: { id: string; a: string; b: string; l1: string; l2: string; d: string; l3: string };
  let x: string;
  let y: string;

  const insert = async (table: string, columns: Record<string, unknown>) => {
    const names = Object.keys(columns);
    const [{ id }] = await db.query<{ id: string }[]>(
      `INSERT INTO ${table} (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(columns),
    );
    return id;
  };
  const course = (slug: string, published = true) =>
    insert('courses', {
      slug,
      title: slug,
      summary: slug,
      status: published ? 'published' : 'draft',
      published_at: published ? new Date() : null,
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
  /** Course c with its curriculum (slug parameterized so the race tests get fresh courses). */
  const buildCourse = async (slug: string) => {
    const id = await course(slug);
    const a = await section(id, 'A', 0);
    const b = await section(id, 'B', 1);
    return {
      id,
      a,
      b,
      l1: await lesson(a, 'l1', 0, { duration_seconds: 600 }),
      l2: await lesson(a, 'l2', 1),
      d: await lesson(a, 'd', 2, { status: 'draft' }),
      l3: await lesson(b, 'l3', 0),
    };
  };

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    admin = await signInAs(app, { role: 'admin' });
    learner = await signInAs(app);
    c = await buildCourse('c');
    const c2 = await course('c2');
    x = await lesson(await section(c2, 'X', 0), 'x', 0);
    const c3 = await course('c3', false);
    y = await lesson(await section(c3, 'Y', 0), 'y', 0);
  });
  afterAll(async () => {
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const save = (slug: string, lessonId: string, body: object, cookie = learner.cookie) =>
    server()
      .put(`/learn/courses/${slug}/lessons/${lessonId}/progress`)
      .set(XHR)
      .set('Cookie', cookie)
      .send(body);
  const rows = (userId = learner.user.id) =>
    db.query<Row[]>(`SELECT * FROM lesson_progress WHERE user_id = $1 ORDER BY lesson_id`, [
      userId,
    ]);
  const rowOf = async (lessonId: string, userId = learner.user.id) =>
    (
      await db.query<Row[]>(`SELECT * FROM lesson_progress WHERE user_id = $1 AND lesson_id = $2`, [
        userId,
        lessonId,
      ])
    )[0];

  describe('with an active grant', () => {
    beforeEach(async () => {
      await grantDirect(learner.user.id, c.id);
    });

    it('creates the row (204, empty body), then updates the same row', async () => {
      const first = await save('c', c.l1, { positionSeconds: 30 });
      expect(first.status).toBe(204);
      expect(first.text).toBe('');
      const created = await rowOf(c.l1);
      expect(created).toEqual(
        expect.objectContaining({ position_seconds: 30, completed_at: null }),
      );

      expect((await save('c', c.l1, { positionSeconds: 45 })).status).toBe(204);
      const updated = await rowOf(c.l1);
      expect(updated.id).toBe(created.id);
      expect(updated.position_seconds).toBe(45);
      expect(updated.last_watched_at.getTime()).toBeGreaterThanOrEqual(
        created.last_watched_at.getTime(),
      );
      expect(await rows()).toHaveLength(1);
    });

    it('keeps completion sticky across a later save without it', async () => {
      await save('c', c.l1, { positionSeconds: 590, completed: true });
      const completedAt = (await rowOf(c.l1)).completed_at;
      expect(completedAt).toBeInstanceOf(Date);
      await save('c', c.l1, { positionSeconds: 10 });
      await save('c', c.l1, { positionSeconds: 20, completed: true });
      const row = await rowOf(c.l1);
      expect(row.position_seconds).toBe(20);
      expect(row.completed_at).toEqual(completedAt); // the first completion instant is kept
    });

    it('clamps the position to a known duration on write, not to an unknown one', async () => {
      await save('c', c.l1, { positionSeconds: 900 });
      await save('c', c.l2, { positionSeconds: 900 });
      expect((await rowOf(c.l1)).position_seconds).toBe(600);
      expect((await rowOf(c.l2)).position_seconds).toBe(900);
    });

    it.each([
      [
        'completed: false',
        { positionSeconds: 5, completed: false },
        invalid('completed', 'INVALID'),
      ],
      ['a negative position', { positionSeconds: -1 }, invalid('positionSeconds', 'TOO_SMALL')],
      [
        'a position over a day',
        { positionSeconds: 86_401 },
        invalid('positionSeconds', 'TOO_LARGE'),
      ],
      [
        'a fractional position',
        { positionSeconds: 1.5 },
        invalid('positionSeconds', 'INVALID_TYPE'),
      ],
      ['a missing position', {}, invalid('positionSeconds', 'REQUIRED')],
      ['a client user id', { positionSeconds: 5, userId: 'x' }, invalid('userId', 'UNKNOWN_FIELD')],
    ])('rejects %s (400) and writes nothing', async (_case, body, expected) => {
      const res = await save('c', c.l1, body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual(expected);
      expect(await rows()).toEqual([]);
    });

    it('gives 404 and writes nothing for a draft lesson, another course’s lesson, a draft course or a malformed id', async () => {
      await grantDirect(
        learner.user.id,
        (await db.query<{ id: string }[]>(`SELECT id FROM courses WHERE slug = 'c3'`))[0].id,
      );
      for (const [slug, lessonId] of [
        ['c', c.d],
        ['c', x],
        ['c3', y],
        ['missing', c.l1],
      ]) {
        expect((await save(slug, lessonId, { positionSeconds: 5 })).body).toEqual(notFound);
      }
      expect((await save('c', 'x', { positionSeconds: 5 })).status).toBe(400);
      expect(await rows()).toEqual([]);
    });

    it("never touches another learner's row or another lesson's row", async () => {
      const other = await signInAs(app);
      await grantDirect(other.user.id, c.id);
      await save('c', c.l1, { positionSeconds: 100, completed: true });
      await save('c', c.l3, { positionSeconds: 7 });
      await save('c', c.l1, { positionSeconds: 5 }, other.cookie);
      expect((await rowOf(c.l1)).position_seconds).toBe(100);
      expect((await rowOf(c.l1)).completed_at).toBeInstanceOf(Date);
      expect((await rowOf(c.l3)).position_seconds).toBe(7);
      expect(await rowOf(c.l1, other.user.id)).toEqual(
        expect.objectContaining({ position_seconds: 5, completed_at: null }),
      );
    });
  });

  describe('without access', () => {
    it('refuses a never-granted learner and an admin without a grant (403), writing nothing', async () => {
      expect((await save('c', c.l1, { positionSeconds: 5 })).body).toEqual(accessRequired);
      expect((await save('c', c.l1, { positionSeconds: 5 }, admin.cookie)).body).toEqual(
        accessRequired,
      );
      expect(await db.query(`SELECT 1 FROM lesson_progress`)).toEqual([]);
    });

    it('refuses after a revocation and keeps the saved row unchanged (CP2, CP6)', async () => {
      const access = `/admin/courses/${c.id}/access/${learner.user.id}`;
      await server().put(access).set(XHR).set('Cookie', admin.cookie);
      await save('c', c.l1, { positionSeconds: 120 });
      const before = await rowOf(c.l1);
      await server().delete(access).set(XHR).set('Cookie', admin.cookie);
      expect((await save('c', c.l1, { positionSeconds: 300, completed: true })).body).toEqual(
        accessRequired,
      );
      expect(await rowOf(c.l1)).toEqual(before);
    });

    it('needs a session (401) and the CSRF header (403)', async () => {
      expect(
        (
          await server()
            .put(`/learn/courses/c/lessons/${c.l1}/progress`)
            .set(XHR)
            .send({ positionSeconds: 5 })
        ).body,
      ).toEqual(unauthenticated);
      await grantDirect(learner.user.id, c.id);
      const noCsrf = await server()
        .put(`/learn/courses/c/lessons/${c.l1}/progress`)
        .set('Cookie', learner.cookie)
        .send({ positionSeconds: 5 });
      expect(noCsrf.status).toBe(403);
      expect(await rows()).toEqual([]);
    });
  });

  describe('completion in both serial orders (owner R7b, deterministic)', () => {
    beforeEach(async () => {
      await grantDirect(learner.user.id, c.id);
    });

    it.each([
      [
        'completing first, then an older incomplete save',
        [{ positionSeconds: 590, completed: true }, { positionSeconds: 100 }],
        100,
      ],
      [
        'an incomplete save first, then the completing one',
        [{ positionSeconds: 100 }, { positionSeconds: 590, completed: true }],
        590,
      ],
    ])('%s → completed, last arrival’s position', async (_case, bodies, position) => {
      for (const body of bodies) expect((await save('c', c.l1, body)).status).toBe(204);
      const row = await rowOf(c.l1);
      expect(row.completed_at).toBeInstanceOf(Date);
      expect(row.position_seconds).toBe(position);
    });
  });

  describe('concurrency (spec §18 R7; owner R7b)', () => {
    const TRIALS = 15;

    it('R7: a progress save ∥ a curriculum order moving that lesson → 204 and 200, no 500; the row follows the lesson', async () => {
      for (let trial = 0; trial < TRIALS; trial++) {
        const k = await buildCourse(`r7-${trial}`);
        await grantDirect(learner.user.id, k.id);
        const [saved, ordered] = await Promise.all([
          save(`r7-${trial}`, k.l1, { positionSeconds: 42 }),
          server()
            .put(`/admin/courses/${k.id}/curriculum-order`)
            .set(XHR)
            .set('Cookie', admin.cookie)
            .send({
              sections: [
                { id: k.a, lessonIds: [k.l2, k.d] },
                { id: k.b, lessonIds: [k.l3, k.l1] },
              ],
            }),
        ]);
        expect([saved.status, ordered.status]).toEqual([204, 200]);
        expect((await rowOf(k.l1)).position_seconds).toBe(42);
        const [{ section_id }] = await db.query<{ section_id: string }[]>(
          `SELECT section_id FROM course_lessons WHERE id = $1`,
          [k.l1],
        );
        expect(section_id).toBe(k.b);
      }
    });

    it('R7b: a completing save ∥ an older incomplete save (arrival order uncontrolled) → completion kept, one row, a position from one of them', async () => {
      await grantDirect(learner.user.id, c.id);
      for (let trial = 0; trial < TRIALS; trial++) {
        await db.query(`DELETE FROM lesson_progress WHERE user_id = $1`, [learner.user.id]);
        const results = await Promise.all([
          save('c', c.l1, { positionSeconds: 590, completed: true }),
          save('c', c.l1, { positionSeconds: 100 }),
        ]);
        expect(results.map((r) => r.status)).toEqual([204, 204]);
        const all = await rows();
        expect(all).toHaveLength(1);
        expect(all[0].completed_at).toBeInstanceOf(Date);
        expect([590, 100]).toContain(all[0].position_seconds);
      }
    });
  });
});
