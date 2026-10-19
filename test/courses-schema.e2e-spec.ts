import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource, QueryFailedError, type QueryRunner } from 'typeorm';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

/** The constraint a failed statement names, or its SQLSTATE when it names none. */
const failureOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof QueryFailedError) {
      const driverError = error.driverError as { constraint?: string; code?: string };
      return driverError.constraint ?? driverError.code;
    }
    throw error;
  }
  throw new Error('expected the statement to fail');
};

describe('course catalog invariants (courses, course_sections, course_lessons)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let courseId: string;
  let sectionId: string;

  // Raw SQL on purpose: these tests probe the database's own constraints, not the entities.
  const insert = (table: string, columns: Record<string, unknown>, runner?: QueryRunner) => {
    const names = Object.keys(columns);
    const sql = `INSERT INTO ${table} (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`;
    return (runner ?? db).query<{ id: string }[]>(sql, Object.values(columns));
  };
  const insertCourse = (columns: Record<string, unknown> = {}) =>
    insert('courses', { slug: 'khoa-hoc', title: 'Khóa', summary: 'Tóm tắt', ...columns });
  const insertSection = (columns: Record<string, unknown> = {}) =>
    insert('course_sections', { course_id: courseId, title: 'Phần', position: 0, ...columns });
  const insertLesson = (columns: Record<string, unknown> = {}, runner?: QueryRunner) =>
    insert(
      'course_lessons',
      { section_id: sectionId, title: 'Bài', position: 0, ...columns },
      runner,
    );

  /** A second connection with its own transaction; always rolled back and released. */
  const withRunner = async <T>(work: (runner: QueryRunner) => Promise<T>): Promise<T> => {
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      return await work(runner);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
      await runner.release();
    }
  };

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    [{ id: courseId }] = await insertCourse();
    [{ id: sectionId }] = await insertSection();
  });
  afterAll(async () => {
    await app.close();
  });

  it('fills uuid v7 ids, draft statuses and timestamps by default', async () => {
    const [{ id: lessonId }] = await insertLesson();
    const [row] = await db.query<
      { course: string; lesson: string; cs: string; ls: string; c: Date; u: Date }[]
    >(
      `SELECT c.id AS course, l.id AS lesson, c.status AS cs, l.status AS ls, l.created_at AS c, l.updated_at AS u
       FROM courses c JOIN course_sections s ON s.course_id = c.id JOIN course_lessons l ON l.section_id = s.id
       WHERE l.id = $1`,
      [lessonId],
    );
    expect(row.course).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(row.lesson).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect([row.cs, row.ls]).toEqual(['draft', 'draft']);
    expect(row.c).toBeInstanceOf(Date);
    expect(row.u).toBeInstanceOf(Date);
  });

  describe('courses', () => {
    it.each([
      ['uq_courses_slug', { slug: 'khoa-hoc' }],
      ['ck_courses_slug_format', { slug: 'Khoa-Hoc' }],
      ['ck_courses_title_not_blank', { slug: 'a', title: '   ' }],
      ['ck_courses_summary_not_blank', { slug: 'a', summary: '   ' }],
      ['ck_courses_status', { slug: 'a', status: 'archived' }],
      ['ck_courses_published_has_date', { slug: 'a', status: 'published' }],
    ])('fails on %s', async (constraint, columns) => {
      expect(await failureOf(insertCourse(columns))).toBe(constraint);
    });

    it('fails on fk_course_sections_course_id when a course with sections is deleted', async () => {
      expect(await failureOf(db.query('DELETE FROM courses WHERE id = $1', [courseId]))).toBe(
        'fk_course_sections_course_id',
      );
    });
  });

  describe('course_sections', () => {
    it.each([
      ['ck_course_sections_title_not_blank', { position: 1, title: '   ' }],
      ['ck_course_sections_position_not_negative', { position: -1 }],
    ])('fails on %s', async (constraint, columns) => {
      expect(await failureOf(insertSection(columns))).toBe(constraint);
    });
  });

  describe('course_lessons', () => {
    it.each([
      ['ck_course_lessons_title_not_blank', { title: '   ' }],
      ['ck_course_lessons_position_not_negative', { position: -1 }],
      ['ck_course_lessons_status', { status: 'archived' }],
      ['ck_course_lessons_published_has_video', { status: 'published' }],
      ['ck_course_lessons_vimeo_video_id_format', { vimeo_video_id: '12a' }],
      ['ck_course_lessons_vimeo_hash_format', { vimeo_video_id: '1', vimeo_hash: 'a-b' }],
      ['ck_course_lessons_hash_needs_video', { vimeo_hash: 'abc' }],
      ['ck_course_lessons_duration_positive', { duration_seconds: 0 }],
    ])('fails on %s', async (constraint, columns) => {
      expect(await failureOf(insertLesson(columns))).toBe(constraint);
    });

    it('fails on fk_course_lessons_section_id when a section with a lesson is deleted', async () => {
      await insertLesson();
      expect(
        await failureOf(db.query('DELETE FROM course_sections WHERE id = $1', [sectionId])),
      ).toBe('fk_course_lessons_section_id');
    });
  });

  describe('deferred position uniques (spike S7, runtime proof)', () => {
    it('accepts a duplicate lesson position until COMMIT, then fails on uq_course_lessons_section_id_position', async () => {
      await withRunner(async (runner) => {
        await runner.startTransaction();
        await insertLesson({ title: 'Một', position: 0 }, runner);
        await insertLesson({ title: 'Hai', position: 0 }, runner); // no error yet: checked at commit
        expect(await failureOf(runner.commitTransaction())).toBe(
          'uq_course_lessons_section_id_position',
        );
      });
      const [{ n }] = await db.query<{ n: number }[]>(
        'SELECT count(*)::int AS n FROM course_lessons',
      );
      expect(n).toBe(0);
    });

    it('fails on uq_course_sections_course_id_position at COMMIT too', async () => {
      await withRunner(async (runner) => {
        await runner.startTransaction();
        await insert(
          'course_sections',
          { course_id: courseId, title: 'Trùng', position: 0 },
          runner,
        );
        expect(await failureOf(runner.commitTransaction())).toBe(
          'uq_course_sections_course_id_position',
        );
      });
    });

    it('commits a swap of two lesson positions written as plain updates', async () => {
      const [{ id: first }] = await insertLesson({ title: 'Một', position: 0 });
      const [{ id: second }] = await insertLesson({ title: 'Hai', position: 1 });
      await db.transaction(async (manager) => {
        await manager.query('UPDATE course_lessons SET position = 1 WHERE id = $1', [first]);
        await manager.query('UPDATE course_lessons SET position = 0 WHERE id = $1', [second]);
      });
      const rows = await db.query<{ id: string }[]>(
        'SELECT id FROM course_lessons ORDER BY position',
      );
      expect(rows.map((row) => row.id)).toEqual([second, first]);
    });
  });

  describe('course lock vs FK checks (spike S9, runtime proof)', () => {
    /**
     * Connection A holds `lock` on the course row; connection B inserts a section for that course, whose FK
     * check takes FOR KEY SHARE on the course row. Returns B's failure, or `null` when the insert succeeded.
     */
    const insertWhileLocked = async (lock: 'FOR NO KEY UPDATE' | 'FOR UPDATE') =>
      withRunner(async (a) => {
        await a.startTransaction();
        await a.query(`SELECT id FROM courses WHERE id = $1 ${lock}`, [courseId]);
        return withRunner(async (b) => {
          await b.startTransaction();
          await b.query(`SET LOCAL lock_timeout = '2s'`);
          try {
            await insert('course_sections', { course_id: courseId, title: 'B', position: 1 }, b);
            return null;
          } catch (error) {
            return failureOf(Promise.reject(error));
          }
        });
      });

    it('FOR NO KEY UPDATE on the course does not block an FK insert under it', async () => {
      expect(await insertWhileLocked('FOR NO KEY UPDATE')).toBeNull();
    });

    it('FOR UPDATE (the blog lock) would block it: lock timeout 55P03', async () => {
      expect(await insertWhileLocked('FOR UPDATE')).toBe('55P03');
    });

    /**
     * A updates a lesson; B asks for FOR KEY SHARE on that row (what a progress FK check will take in outcome 3).
     * Returns B's failure, or `null` when it got the lock.
     */
    const keyShareWhileUpdating = async (update: string) => {
      const [{ id: lessonId }] = await insertLesson();
      return withRunner(async (a) => {
        await a.startTransaction();
        await a.query(`UPDATE course_lessons SET ${update} WHERE id = $1`, [lessonId]);
        return withRunner(async (b) => {
          await b.startTransaction();
          await b.query(`SET LOCAL lock_timeout = '2s'`);
          try {
            await b.query('SELECT id FROM course_lessons WHERE id = $1 FOR KEY SHARE', [lessonId]);
            return null;
          } catch (error) {
            return failureOf(Promise.reject(error));
          }
        });
      });
    };

    it('a title edit takes no key lock on the lesson row', async () => {
      expect(await keyShareWhileUpdating(`title = 'Mới'`)).toBeNull();
    });

    it('a position move takes FOR UPDATE: the deferrable unique still counts as a key', async () => {
      expect(await keyShareWhileUpdating('position = 5')).toBe('55P03');
    });
  });

  describe('course_access_grants (outcome 2)', () => {
    const UNKNOWN_ID = '01900000-0000-7000-8000-000000000000';
    let learnerId: string;
    let adminId: string;

    const insertGrant = (columns: Record<string, unknown> = {}) =>
      insert('course_access_grants', {
        user_id: learnerId,
        course_id: courseId,
        source: 'admin',
        granted_by_user_id: adminId,
        ...columns,
      });

    beforeEach(async () => {
      [{ id: learnerId }] = await insert('users', { email: 'hoc@example.vn', display_name: 'Học' });
      [{ id: adminId }] = await insert('users', {
        email: 'admin@example.vn',
        display_name: 'Admin',
        role: 'admin',
      });
    });

    it('fills a uuid v7 id and the grant timestamps; a new grant is active', async () => {
      const [{ id }] = await insertGrant();
      const [row] = await db.query<
        { id: string; granted_at: Date; created_at: Date; updated_at: Date; revoked_at: null }[]
      >(
        `SELECT id, granted_at, created_at, updated_at, revoked_at FROM course_access_grants WHERE id = $1`,
        [id],
      );
      expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
      expect(row.granted_at).toBeInstanceOf(Date);
      expect(row.created_at).toBeInstanceOf(Date);
      expect(row.updated_at).toBeInstanceOf(Date);
      expect(row.revoked_at).toBeNull();
    });

    it('fails on uq_course_access_grants_user_id_course_id_active_admin for a second active admin grant', async () => {
      await insertGrant();
      expect(await failureOf(insertGrant())).toBe(
        'uq_course_access_grants_user_id_course_id_active_admin',
      );
    });

    it('accepts a new active grant once the first is revoked: the partial index keeps history', async () => {
      const [{ id: first }] = await insertGrant();
      await db.query(
        `UPDATE course_access_grants SET revoked_at = now(), revoked_by_user_id = $2 WHERE id = $1`,
        [first, adminId],
      );
      const [{ id: second }] = await insertGrant();
      const rows = await db.query<{ id: string; active: boolean }[]>(
        `SELECT id, revoked_at IS NULL AS active FROM course_access_grants ORDER BY id`,
      );
      expect(rows).toEqual([
        { id: first, active: false },
        { id: second, active: true },
      ]);
    });

    it.each([
      ['ck_course_access_grants_source', { source: 'purchase' }],
      ['ck_course_access_grants_admin_has_granter', { granted_by_user_id: null }],
      ['ck_course_access_grants_revocation_pair', { revoked_at: new Date() }],
      ['fk_course_access_grants_user_id', { user_id: UNKNOWN_ID }],
      ['fk_course_access_grants_course_id', { course_id: UNKNOWN_ID }],
      ['fk_course_access_grants_granted_by_user_id', { granted_by_user_id: UNKNOWN_ID }],
    ])('fails on %s', async (constraint, columns) => {
      expect(await failureOf(insertGrant(columns))).toBe(constraint);
    });

    it('fails on ck_course_access_grants_revocation_pair for a revoker without a revocation instant', async () => {
      expect(await failureOf(insertGrant({ revoked_by_user_id: adminId }))).toBe(
        'ck_course_access_grants_revocation_pair',
      );
    });

    it('fails on fk_course_access_grants_revoked_by_user_id for an unknown revoker', async () => {
      expect(
        await failureOf(insertGrant({ revoked_at: new Date(), revoked_by_user_id: UNKNOWN_ID })),
      ).toBe('fk_course_access_grants_revoked_by_user_id');
    });

    it('fails on fk_course_access_grants_course_id when a granted course is deleted', async () => {
      await db.query('DELETE FROM course_lessons');
      await db.query('DELETE FROM course_sections');
      await insertGrant();
      expect(await failureOf(db.query('DELETE FROM courses WHERE id = $1', [courseId]))).toBe(
        'fk_course_access_grants_course_id',
      );
    });
  });

  describe('lesson_progress (outcome 3)', () => {
    const UNKNOWN_ID = '01900000-0000-7000-8000-000000000000';
    let learnerId: string;
    let lessonId: string;

    const insertProgress = (columns: Record<string, unknown> = {}) =>
      insert('lesson_progress', {
        user_id: learnerId,
        lesson_id: lessonId,
        position_seconds: 30,
        ...columns,
      });

    beforeEach(async () => {
      [{ id: learnerId }] = await insert('users', { email: 'hoc@example.vn', display_name: 'Học' });
      [{ id: lessonId }] = await insertLesson();
    });

    it('fills a uuid v7 id and the timestamps; completion starts empty', async () => {
      const [{ id }] = await insertProgress();
      const [row] = await db.query<
        {
          id: string;
          completed_at: Date | null;
          last_watched_at: Date;
          created_at: Date;
          updated_at: Date;
        }[]
      >(
        `SELECT id, completed_at, last_watched_at, created_at, updated_at FROM lesson_progress WHERE id = $1`,
        [id],
      );
      expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
      expect(row.completed_at).toBeNull();
      expect(row.last_watched_at).toBeInstanceOf(Date);
      expect(row.created_at).toBeInstanceOf(Date);
      expect(row.updated_at).toBeInstanceOf(Date);
    });

    it.each([
      ['ck_lesson_progress_position_not_negative', { position_seconds: -1 }],
      ['fk_lesson_progress_user_id', { user_id: UNKNOWN_ID }],
      ['fk_lesson_progress_lesson_id', { lesson_id: UNKNOWN_ID }],
    ])('fails on %s', async (constraint, columns) => {
      expect(await failureOf(insertProgress(columns))).toBe(constraint);
    });

    it('fails on uq_lesson_progress_user_id_lesson_id for a second row of the same user and lesson', async () => {
      await insertProgress();
      expect(await failureOf(insertProgress({ position_seconds: 60 }))).toBe(
        'uq_lesson_progress_user_id_lesson_id',
      );
    });

    it('fails on fk_lesson_progress_lesson_id when a lesson with progress is deleted', async () => {
      await insertProgress();
      expect(
        await failureOf(db.query('DELETE FROM course_lessons WHERE id = $1', [lessonId])),
      ).toBe('fk_lesson_progress_lesson_id');
    });
  });
});
