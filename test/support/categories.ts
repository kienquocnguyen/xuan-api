import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

export type TestCategory = { id: string; key: string; slug: string; label: string };

/** Inserts a category and its Vietnamese name directly, independent of the code under test (blog B2). */
export async function insertCategory(
  app: INestApplication,
  {
    key = 'du-lich',
    slug,
    label = 'Du lịch',
    status = 'active',
  }: { key?: string; slug?: string; label?: string; status?: string } = {},
): Promise<TestCategory> {
  const db = app.get(DataSource);
  const [{ id }] = await db.query<{ id: string }[]>(
    'INSERT INTO content_categories (key, status) VALUES ($1, $2) RETURNING id',
    [key, status],
  );
  await db.query(
    'INSERT INTO content_category_translations (category_id, slug, label) VALUES ($1, $2, $3)',
    [id, slug ?? key, label],
  );
  return { id, key, slug: slug ?? key, label };
}
