import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const notFound = {
  data: null,
  error: { code: 'NOT_FOUND', message: 'The requested resource was not found.', details: {} },
};

describe('Public courses (/courses)', () => {
  let app: NestExpressApplication;
  let db: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });
  afterAll(async () => {
    await app.close();
  });

  const server = () => request(app.getHttpServer());

  // Fixtures write rows directly, independent of the admin API.
  const insertCourse = async (
    slug: string,
    {
      status = 'published',
      publishedAt = '2026-10-01T00:00:00.000Z',
    }: { status?: string; publishedAt?: string | null } = {},
  ): Promise<string> => {
    const [row] = await db.query<{ id: string }[]>(
      `INSERT INTO courses (slug, title, summary, status, published_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [slug, `Khóa ${slug}`, `Tóm tắt ${slug}`, status, publishedAt],
    );
    return row.id;
  };
  const insertSection = async (courseId: string, title: string, position: number) => {
    const [row] = await db.query<{ id: string }[]>(
      `INSERT INTO course_sections (course_id, title, position) VALUES ($1, $2, $3) RETURNING id`,
      [courseId, title, position],
    );
    return row.id;
  };
  const insertLesson = async (
    sectionId: string,
    title: string,
    position: number,
    {
      status = 'published',
      durationSeconds = null,
    }: { status?: string; durationSeconds?: number | null } = {},
  ) => {
    const [row] = await db.query<{ id: string }[]>(
      `INSERT INTO course_lessons (section_id, title, position, status, vimeo_video_id, vimeo_hash, duration_seconds)
       VALUES ($1, $2, $3, $4, '76979871', 'a1b2c3', $5) RETURNING id`,
      [sectionId, title, position, status, durationSeconds],
    );
    return row.id;
  };

  describe('GET /courses', () => {
    it('lists only published courses, newest publication first, with summary fields only', async () => {
      const older = await insertCourse('cu', { publishedAt: '2026-09-01T00:00:00.000Z' });
      await insertCourse('nhap', { status: 'draft', publishedAt: null });
      // Unpublished after a first publication: keeps published_at but isn't public.
      await insertCourse('da-go', { status: 'draft', publishedAt: '2026-09-15T00:00:00.000Z' });
      const newer = await insertCourse('moi', { publishedAt: '2026-10-01T00:00:00.000Z' });

      const res = await server().get('/courses');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: [
          {
            id: newer,
            slug: 'moi',
            title: 'Khóa moi',
            summary: 'Tóm tắt moi',
            publishedAt: '2026-10-01T00:00:00.000Z',
          },
          {
            id: older,
            slug: 'cu',
            title: 'Khóa cu',
            summary: 'Tóm tắt cu',
            publishedAt: '2026-09-01T00:00:00.000Z',
          },
        ],
      });
    });

    it('returns an empty list when nothing is published', async () => {
      await insertCourse('nhap', { status: 'draft', publishedAt: null });
      const res = await server().get('/courses');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [] });
    });
  });

  describe('GET /courses/:slug', () => {
    it('returns the published outline in curriculum order, without drafts, empty sections or video fields', async () => {
      const courseId = await insertCourse('workflow-edit-video-youtube');
      // Inserted out of order: the outline follows `position`, not insertion.
      const second = await insertSection(courseId, 'Phần 2', 1);
      const first = await insertSection(courseId, 'Phần 1', 0);
      const draftsOnly = await insertSection(courseId, 'Phần nháp', 2);
      const l2 = await insertLesson(first, 'Bài 1.2', 1, { durationSeconds: 600 });
      const l1 = await insertLesson(first, 'Bài 1.1', 0);
      await insertLesson(first, 'Bài 1.3 (nháp)', 2, { status: 'draft' });
      const l3 = await insertLesson(second, 'Bài 2.1', 0, { durationSeconds: 90 });
      await insertLesson(draftsOnly, 'Chỉ nháp', 0, { status: 'draft' });

      const res = await server().get('/courses/workflow-edit-video-youtube');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: {
          id: courseId,
          slug: 'workflow-edit-video-youtube',
          title: 'Khóa workflow-edit-video-youtube',
          summary: 'Tóm tắt workflow-edit-video-youtube',
          publishedAt: '2026-10-01T00:00:00.000Z',
          sections: [
            {
              id: first,
              title: 'Phần 1',
              lessons: [
                { id: l1, title: 'Bài 1.1', durationSeconds: null },
                { id: l2, title: 'Bài 1.2', durationSeconds: 600 },
              ],
            },
            {
              id: second,
              title: 'Phần 2',
              lessons: [{ id: l3, title: 'Bài 2.1', durationSeconds: 90 }],
            },
          ],
        },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/videoId|privacyHash|vimeo|76979871|a1b2c3/);
    });

    it('omits every section but the one holding all published lessons (Review Focus 5)', async () => {
      const courseId = await insertCourse('mot-phan');
      await insertSection(courseId, 'Trống', 0);
      const middle = await insertSection(courseId, 'Giữa', 1);
      const drafts = await insertSection(courseId, 'Nháp', 2);
      const b = await insertLesson(middle, 'B', 1);
      const a = await insertLesson(middle, 'A', 0);
      await insertLesson(drafts, 'Nháp', 0, { status: 'draft' });

      const res = await server().get('/courses/mot-phan');
      expect(res.status).toBe(200);
      expect(res.body.data.sections).toEqual([
        {
          id: middle,
          title: 'Giữa',
          lessons: [
            { id: a, title: 'A', durationSeconds: null },
            { id: b, title: 'B', durationSeconds: null },
          ],
        },
      ]);
    });

    it('gives 404 for a draft course, including one unpublished after publication', async () => {
      await insertCourse('nhap', { status: 'draft', publishedAt: null });
      await insertCourse('da-go', { status: 'draft', publishedAt: '2026-09-15T00:00:00.000Z' });
      for (const slug of ['nhap', 'da-go']) {
        const res = await server().get(`/courses/${slug}`);
        expect(res.status).toBe(404);
        expect(res.body).toEqual(notFound);
      }
    });

    it.each([
      ['an unknown slug', 'khong-co'],
      ['an uppercase slug', 'Khoa-Hoc'],
      ['a slug with diacritics', encodeURIComponent('khóa-học')],
      ['a 300-character slug', 'a'.repeat(300)],
      ['a NUL', '%00'],
    ])('gives 404 for %s, never 500 (Review Focus 2)', async (_case, slug) => {
      await insertCourse('khoa-hoc');
      const res = await server().get(`/courses/${slug}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(notFound);
    });
  });
});
