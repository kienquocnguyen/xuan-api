import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource, QueryFailedError } from 'typeorm';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const constraintOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof QueryFailedError) {
      return (error.driverError as { constraint?: string }).constraint;
    }
    throw error;
  }
  throw new Error('expected the statement to fail');
};

const UNKNOWN_ID = '01900000-0000-7000-8000-000000000000';

// Raw SQL on purpose: the database's own constraints (blog completion B4, database.md §12).
describe('content_post_ratings and content_post_comments invariants', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let userId: string;
  let postId: string;

  const insert = (table: string, columns: Record<string, unknown>) => {
    const names = Object.keys(columns);
    return db.query<{ id: string }[]>(
      `INSERT INTO ${table} (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(columns),
    );
  };
  const rating = (columns: Record<string, unknown> = {}) =>
    insert('content_post_ratings', { post_id: postId, user_id: userId, value: 4, ...columns });
  const comment = (columns: Record<string, unknown> = {}) =>
    insert('content_post_comments', { post_id: postId, user_id: userId, body: 'Hay', ...columns });

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    [{ id: userId }] = await db.query<{ id: string }[]>(
      `INSERT INTO users (email, display_name, role) VALUES ('r@example.com', 'R', 'user') RETURNING id`,
    );
    [{ id: postId }] = await db.query<{ id: string }[]>(
      `INSERT INTO content_posts (author_id, slug, title, body) VALUES ($1, 'bai', 'Bài', '{"type":"doc","content":[]}') RETURNING id`,
      [userId],
    );
  });
  afterAll(async () => {
    await app.close();
  });

  it('fills uuid v7 ids, visible status and timestamps by default', async () => {
    const [{ id: r }] = await rating();
    const [{ id: c }] = await comment();
    for (const [table, id] of [
      ['content_post_ratings', r],
      ['content_post_comments', c],
    ]) {
      const [row] = await db.query<
        { id: string; status: string; created_at: Date; updated_at: Date }[]
      >(`SELECT id, status, created_at, updated_at FROM ${table} WHERE id = $1`, [id]);
      expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
      expect(row.status).toBe('visible');
      expect(row.created_at).toBeInstanceOf(Date);
      expect(row.updated_at).toBeInstanceOf(Date);
    }
  });

  it('keeps one rating per user per post, whatever its status', async () => {
    await rating({ status: 'hidden' });
    expect(await constraintOf(rating())).toBe('uq_content_post_ratings_post_id_user_id');
  });

  it.each([0, 6])('refuses a rating of %i', async (value) => {
    expect(await constraintOf(rating({ value }))).toBe('ck_content_post_ratings_value');
  });

  it('refuses unknown statuses: ratings are never deleted', async () => {
    expect(await constraintOf(rating({ status: 'deleted' }))).toBe(
      'ck_content_post_ratings_status',
    );
    expect(await constraintOf(comment({ status: 'removed' }))).toBe(
      'ck_content_post_comments_status',
    );
    await comment({ status: 'deleted' });
  });

  it('refuses a blank comment', async () => {
    expect(await constraintOf(comment({ body: ' \n\t ' }))).toBe(
      'ck_content_post_comments_body_not_blank',
    );
  });

  it('records the moderator and the time together, or neither', async () => {
    for (const [table, insertRow] of [
      ['content_post_ratings', rating],
      ['content_post_comments', comment],
    ] as const) {
      expect(await constraintOf(insertRow({ moderated_by: userId }))).toBe(
        `ck_${table}_moderation_pair`,
      );
      expect(await constraintOf(insertRow({ moderated_at: new Date() }))).toBe(
        `ck_${table}_moderation_pair`,
      );
    }
    await comment({ moderated_by: userId, moderated_at: new Date() });
  });

  it('names every foreign key, and posts and users with discussion are never deleted', async () => {
    for (const [table, insertRow] of [
      ['content_post_ratings', rating],
      ['content_post_comments', comment],
    ] as const) {
      expect(await constraintOf(insertRow({ post_id: UNKNOWN_ID }))).toBe(`fk_${table}_post_id`);
      expect(await constraintOf(insertRow({ user_id: UNKNOWN_ID }))).toBe(`fk_${table}_user_id`);
      expect(
        await constraintOf(insertRow({ moderated_by: UNKNOWN_ID, moderated_at: new Date() })),
      ).toBe(`fk_${table}_moderated_by`);
    }
    await rating();
    expect(await constraintOf(db.query('DELETE FROM content_posts WHERE id = $1', [postId]))).toBe(
      'fk_content_post_ratings_post_id',
    );
    await db.query('DELETE FROM content_post_ratings');
    await comment();
    expect(await constraintOf(db.query('DELETE FROM users WHERE id = $1', [userId]))).toMatch(
      /^fk_content_post_comments_user_id$|^fk_content_posts_author_id$/,
    );
  });

  it('has the indexes the reads use', async () => {
    const rows = await db.query<{ indexname: string; indexdef: string }[]>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('content_post_ratings', 'content_post_comments') ORDER BY indexname`,
    );
    expect(rows.map((row) => row.indexname)).toEqual([
      'ix_content_post_comments_post_id_status_created_at_id',
      'ix_content_post_comments_user_id',
      'ix_content_post_ratings_user_id',
      'pk_content_post_comments',
      'pk_content_post_ratings',
      'uq_content_post_ratings_post_id_user_id',
    ]);
    expect(
      rows.find((row) => row.indexname === 'ix_content_post_comments_post_id_status_created_at_id')
        ?.indexdef,
    ).toContain('(post_id, status, created_at, id)');
  });
});
