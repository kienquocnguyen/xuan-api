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

const DOC = '{"type":"doc","content":[]}';

describe('content_posts invariants', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let authorId: string;

  // Raw SQL on purpose: these tests probe the database's own constraints, not the entity.
  const insertPost = (columns: Record<string, unknown> = {}) => {
    const row: Record<string, unknown> = {
      author_id: authorId,
      slug: 'bai-viet',
      title: 'Bài',
      body: DOC,
      ...columns,
    };
    const names = Object.keys(row);
    return db.query<{ id: string }[]>(
      `INSERT INTO content_posts (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(row),
    );
  };

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    [{ id: authorId }] = await db.query<{ id: string }[]>(
      `INSERT INTO users (email, display_name, role) VALUES ('author@example.com', 'Author', 'editor') RETURNING id`,
    );
  });
  afterAll(async () => {
    await app.close();
  });

  it('fills a uuid v7 id, vi, draft, body version 1 and timestamps by default', async () => {
    const [{ id }] = await insertPost();
    const [row] = await db.query<
      {
        id: string;
        language: string;
        status: string;
        body_version: number;
        published_at: null;
        c: Date;
        u: Date;
      }[]
    >(
      'SELECT id, language, status, body_version, published_at, created_at AS c, updated_at AS u FROM content_posts WHERE id = $1',
      [id],
    );
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(row).toMatchObject({
      language: 'vi',
      status: 'draft',
      body_version: 1,
      published_at: null,
    });
    expect(row.c).toBeInstanceOf(Date);
    expect(row.u).toBeInstanceOf(Date);
  });

  it.each([
    ['ck_content_posts_slug_format', { slug: 'Bai-Viet' }],
    ['ck_content_posts_slug_format', { slug: 'a--b' }],
    ['ck_content_posts_language', { language: 'en' }],
    ['ck_content_posts_title_not_blank', { title: '   ' }],
    ['ck_content_posts_excerpt_not_blank', { excerpt: '' }],
    ['ck_content_posts_seo_title_not_blank', { seo_title: ' ' }],
    ['ck_content_posts_seo_description_not_blank', { seo_description: '' }],
    ['ck_content_posts_body_is_doc', { body: '[]' }],
    ['ck_content_posts_body_is_doc', { body: '"doc"' }],
    ['ck_content_posts_body_is_doc', { body: '{"type":"paragraph"}' }],
    ['ck_content_posts_body_version', { body_version: 2 }],
    ['ck_content_posts_status', { status: 'archived' }],
    ['ck_content_posts_published_has_date', { status: 'published' }],
  ])('%s rejects %o', async (constraint, columns) => {
    expect(await constraintOf(insertPost(columns))).toBe(constraint);
  });

  it('accepts a published post with its date', async () => {
    await expect(
      insertPost({ status: 'published', published_at: new Date() }),
    ).resolves.toHaveLength(1);
  });

  it('keeps slugs unique per language', async () => {
    await insertPost();
    expect(await constraintOf(insertPost())).toBe('uq_content_posts_language_slug');
  });

  it('requires an existing author and keeps authors from being deleted', async () => {
    expect(
      await constraintOf(insertPost({ author_id: '01900000-0000-7000-8000-000000000000' })),
    ).toBe('fk_content_posts_author_id');
    await insertPost();
    expect(await constraintOf(db.query('DELETE FROM users WHERE id = $1', [authorId]))).toBe(
      'fk_content_posts_author_id',
    );
  });
});
