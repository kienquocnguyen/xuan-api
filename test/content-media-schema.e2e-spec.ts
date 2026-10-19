import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
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

// Raw SQL on purpose: the database's own constraints (blog completion B3, database.md §12).
describe('content_media invariants and post media references', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let userId: string;

  const insertMedia = (columns: Record<string, unknown> = {}) => {
    const row: Record<string, unknown> = {
      uploader_id: userId,
      storage_key: `blog/${randomUUID()}`,
      width: 1920,
      height: 1080,
      variant_widths: [640, 1280, 1920],
      byte_size: 1234,
      ...columns,
    };
    const names = Object.keys(row);
    return db.query<{ id: string }[]>(
      `INSERT INTO content_media (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(row),
    );
  };
  const insertPost = (columns: Record<string, unknown> = {}) => {
    const row: Record<string, unknown> = {
      author_id: userId,
      slug: 'bai',
      title: 'Bài',
      body: '{"type":"doc","content":[]}',
      ...columns,
    };
    const names = Object.keys(row);
    return db.query(
      `INSERT INTO content_posts (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(row),
    );
  };

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    [{ id: userId }] = await db.query<{ id: string }[]>(
      `INSERT INTO users (email, display_name, role) VALUES ('e@example.com', 'E', 'editor') RETURNING id`,
    );
  });
  afterAll(async () => {
    await app.close();
  });

  it('fills a uuid v7 id, image/webp and created_at by default', async () => {
    const [{ id }] = await insertMedia();
    const [row] = await db.query<{ id: string; content_type: string; created_at: Date }[]>(
      'SELECT id, content_type, created_at FROM content_media WHERE id = $1',
      [id],
    );
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(row.content_type).toBe('image/webp');
    expect(row.created_at).toBeInstanceOf(Date);
  });

  it.each([
    ['ck_content_media_storage_key_format', { storage_key: 'uploads/anh.jpg' }],
    ['ck_content_media_content_type', { content_type: 'image/svg+xml' }],
    ['ck_content_media_dimensions', { width: 0 }],
    ['ck_content_media_dimensions', { height: 6001 }],
    ['ck_content_media_variant_widths_not_empty', { variant_widths: [] }],
    ['ck_content_media_byte_size_positive', { byte_size: 0 }],
    ['fk_content_media_uploader_id', { uploader_id: UNKNOWN_ID }],
  ])('%s rejects %o', async (constraint, columns) => {
    expect(await constraintOf(insertMedia(columns))).toBe(constraint);
  });

  it('keeps storage keys unique', async () => {
    const key = `blog/${randomUUID()}`;
    await insertMedia({ storage_key: key });
    expect(await constraintOf(insertMedia({ storage_key: key }))).toBe(
      'uq_content_media_storage_key',
    );
  });

  it('links covers and OG images to existing media, kept while referenced', async () => {
    const [{ id }] = await insertMedia();
    await insertPost({ cover_media_id: id, cover_alt: 'Ảnh bìa', og_media_id: id });
    expect(await constraintOf(db.query('DELETE FROM content_media WHERE id = $1', [id]))).toMatch(
      /^fk_content_posts_(cover|og)_media_id$/,
    );
    expect(await constraintOf(insertPost({ slug: 'b', og_media_id: UNKNOWN_ID }))).toBe(
      'fk_content_posts_og_media_id',
    );
  });

  it('requires alt text with a cover and none without', async () => {
    const [{ id }] = await insertMedia();
    expect(await constraintOf(insertPost({ cover_media_id: id }))).toBe(
      'ck_content_posts_cover_alt',
    );
    expect(await constraintOf(insertPost({ cover_media_id: id, cover_alt: '  ' }))).toBe(
      'ck_content_posts_cover_alt',
    );
    expect(await constraintOf(insertPost({ cover_alt: 'Không có ảnh' }))).toBe(
      'ck_content_posts_cover_alt',
    );
  });

  it('accepts body version 2 and rejects 3', async () => {
    await expect(insertPost({ body_version: 2 })).resolves.toBeDefined();
    expect(await constraintOf(insertPost({ slug: 'b', body_version: 3 }))).toBe(
      'ck_content_posts_body_version',
    );
  });
});
