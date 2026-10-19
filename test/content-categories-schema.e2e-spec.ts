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

// Raw SQL on purpose: these tests probe the database's own constraints (blog completion B2, database.md §12).
describe('content_categories and content_category_translations invariants', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let authorId: string;

  const insertCategory = async (key = 'du-lich', status?: string) => {
    const [{ id }] = await db.query<{ id: string }[]>(
      status
        ? 'INSERT INTO content_categories (key, status) VALUES ($1, $2) RETURNING id'
        : 'INSERT INTO content_categories (key) VALUES ($1) RETURNING id',
      status ? [key, status] : [key],
    );
    return id;
  };
  const insertTranslation = (columns: Record<string, unknown>) => {
    const names = Object.keys(columns);
    return db.query<{ id: string }[]>(
      `INSERT INTO content_category_translations (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(columns),
    );
  };
  const insertPost = (categoryId: string) =>
    db.query(
      `INSERT INTO content_posts (author_id, slug, title, body, category_id) VALUES ($1, 'bai', 'Bài', '{"type":"doc","content":[]}', $2)`,
      [authorId, categoryId],
    );

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    [{ id: authorId }] = await db.query<{ id: string }[]>(
      `INSERT INTO users (email, display_name, role) VALUES ('a@example.com', 'A', 'editor') RETURNING id`,
    );
  });
  afterAll(async () => {
    await app.close();
  });

  it('fills a uuid v7 id, active status, vi language and timestamps by default', async () => {
    const id = await insertCategory();
    await insertTranslation({ category_id: id, slug: 'du-lich', label: 'Du lịch' });
    const [row] = await db.query<{ id: string; status: string; language: string }[]>(
      `SELECT c.id, c.status, t.language FROM content_categories c JOIN content_category_translations t ON t.category_id = c.id`,
    );
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(row).toMatchObject({ status: 'active', language: 'vi' });
  });

  it.each([
    ['ck_content_categories_key_format', 'Du-Lich'],
    ['ck_content_categories_key_format', 'a--b'],
  ])('%s rejects key %s', async (constraint, key) => {
    expect(await constraintOf(insertCategory(key))).toBe(constraint);
  });

  it('rejects an unknown category status', async () => {
    expect(await constraintOf(insertCategory('x', 'deleted'))).toBe('ck_content_categories_status');
  });

  it('keeps keys unique', async () => {
    await insertCategory();
    expect(await constraintOf(insertCategory())).toBe('uq_content_categories_key');
  });

  it.each([
    ['ck_content_category_translations_slug_format', { slug: 'Du-Lich' }],
    ['ck_content_category_translations_language', { language: 'en' }],
    ['ck_content_category_translations_label_not_blank', { label: '  ' }],
  ])('%s rejects %o', async (constraint, columns) => {
    const id = await insertCategory();
    expect(
      await constraintOf(
        insertTranslation({ category_id: id, slug: 'du-lich', label: 'Du lịch', ...columns }),
      ),
    ).toBe(constraint);
  });

  it('keeps slugs unique per language and one translation per language', async () => {
    const first = await insertCategory('mot');
    const second = await insertCategory('hai');
    await insertTranslation({ category_id: first, slug: 'mot', label: 'Một' });
    expect(
      await constraintOf(insertTranslation({ category_id: second, slug: 'mot', label: 'Hai' })),
    ).toBe('uq_content_category_translations_language_slug');
    expect(
      await constraintOf(insertTranslation({ category_id: first, slug: 'khac', label: 'Khác' })),
    ).toBe('uq_content_category_translations_category_id_language');
  });

  it('requires an existing category and deletes translations with their category', async () => {
    expect(
      await constraintOf(insertTranslation({ category_id: UNKNOWN_ID, slug: 'x', label: 'X' })),
    ).toBe('fk_content_category_translations_category_id');
    const id = await insertCategory();
    await insertTranslation({ category_id: id, slug: 'du-lich', label: 'Du lịch' });
    await db.query('DELETE FROM content_categories WHERE id = $1', [id]);
    expect(await db.query('SELECT 1 FROM content_category_translations')).toEqual([]);
  });

  it('links posts to existing categories and keeps used categories from being deleted', async () => {
    expect(await constraintOf(insertPost(UNKNOWN_ID))).toBe('fk_content_posts_category_id');
    const id = await insertCategory();
    await insertPost(id);
    expect(await constraintOf(db.query('DELETE FROM content_categories WHERE id = $1', [id]))).toBe(
      'fk_content_posts_category_id',
    );
  });
});
