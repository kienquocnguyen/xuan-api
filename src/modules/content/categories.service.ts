import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { isForeignKeyViolation, isUniqueViolation } from '../../database/postgres-errors.js';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import {
  CATEGORY_LANGUAGE,
  ContentCategory,
  ContentCategoryTranslation,
  type CategoryStatus,
} from './category.entity.js';
import { contentErrors } from './content.errors.js';
import type { CreatePostCategoryInput, UpdatePostCategoryInput } from './dto/category.dto.js';
import { POST_LANGUAGE } from './post.entity.js';

/** What posts need to know about their category (blog completion spec §4). */
export type CategoryRef = Readonly<{
  id: string;
  key: string;
  slug: string;
  label: string;
  status: CategoryStatus;
}>;
export type AdminCategory = CategoryRef &
  Readonly<{ postCount: number; createdAt: Date; updatedAt: Date }>;
export type PublicCategory = Readonly<{ slug: string; label: string; publishedPostCount: number }>;

const collator = new Intl.Collator('vi');
/** Vietnamese label order, ties by key (spec §4.6): small lists, sorted here instead of an ICU collation. */
const byLabel = <T extends { label: string; key: string }>(a: T, b: T) =>
  collator.compare(a.label, b.label) || a.key.localeCompare(b.key);

const REF_SQL = `SELECT c.id, c.key, c.status, t.slug, t.label, c.created_at AS "createdAt", c.updated_at AS "updatedAt"
  FROM content_categories c JOIN content_category_translations t ON t.category_id = c.id AND t.language = $1`;

type RefRow = CategoryRef & { createdAt: Date; updatedAt: Date };

/** Admin-managed post categories (spec §4, BD-3, BD-11). */
@Injectable()
export class CategoriesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async listAdmin(): Promise<AdminCategory[]> {
    const rows = await this.dataSource.query<(RefRow & { postCount: number })[]>(
      `SELECT r.*, (SELECT count(*)::int FROM content_posts p WHERE p.category_id = r.id) AS "postCount"
       FROM (${REF_SQL}) r`,
      [CATEGORY_LANGUAGE],
    );
    return rows.sort(byLabel);
  }

  async getAdmin(id: string): Promise<AdminCategory> {
    const [row] = await this.dataSource.query<(RefRow & { postCount: number })[]>(
      `SELECT r.*, (SELECT count(*)::int FROM content_posts p WHERE p.category_id = r.id) AS "postCount"
       FROM (${REF_SQL} WHERE c.id = $2) r`,
      [CATEGORY_LANGUAGE, id],
    );
    if (!row) throw new AppError(baselineErrors.NOT_FOUND);
    return row;
  }

  /** Active categories with their published Vietnamese posts, zero included; one grouped query. */
  async listPublic(): Promise<PublicCategory[]> {
    const rows = await this.dataSource.query<(PublicCategory & { key: string })[]>(
      `SELECT c.key, t.slug, t.label, count(p.id)::int AS "publishedPostCount"
       FROM content_categories c
       JOIN content_category_translations t ON t.category_id = c.id AND t.language = $1
       LEFT JOIN content_posts p ON p.category_id = c.id AND p.status = 'published' AND p.language = $2
       WHERE c.status = 'active'
       GROUP BY c.id, c.key, t.slug, t.label`,
      [CATEGORY_LANGUAGE, POST_LANGUAGE],
    );
    return rows.sort(byLabel).map(({ slug, label, publishedPostCount }) => ({
      slug,
      label,
      publishedPostCount,
    }));
  }

  /** Category refs for a page of posts: one query, whatever the page size. */
  async findRefs(
    ids: readonly string[],
    manager?: EntityManager,
  ): Promise<Map<string, CategoryRef>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await (manager ?? this.dataSource.manager).query<RefRow[]>(
      `${REF_SQL} WHERE c.id = ANY($2)`,
      [CATEGORY_LANGUAGE, unique],
    );
    return new Map(
      rows.map(({ id, key, slug, label, status }) => [id, { id, key, slug, label, status }]),
    );
  }

  async findActiveBySlug(slug: string): Promise<CategoryRef | null> {
    const [row] = await this.dataSource.query<RefRow[]>(
      `${REF_SQL} WHERE t.slug = $2 AND c.status = 'active'`,
      [CATEGORY_LANGUAGE, slug],
    );
    return row
      ? { id: row.id, key: row.key, slug: row.slug, label: row.label, status: row.status }
      : null;
  }

  async create(input: CreatePostCategoryInput): Promise<AdminCategory> {
    let id: string;
    try {
      id = await this.dataSource.transaction(async (manager) => {
        const result = await manager.insert(ContentCategory, { key: input.key });
        const categoryId = (result.identifiers[0] as { id: string }).id;
        await manager.insert(ContentCategoryTranslation, {
          categoryId,
          slug: input.slug,
          label: input.label,
        });
        return categoryId;
      });
    } catch (error) {
      throw this.translate(error);
    }
    return this.getAdmin(id);
  }

  async update(id: string, input: UpdatePostCategoryInput): Promise<AdminCategory> {
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.lock(manager, id);
        await manager.update(
          ContentCategoryTranslation,
          { categoryId: id, language: CATEGORY_LANGUAGE },
          { slug: input.slug, label: input.label },
        );
        await manager.update(ContentCategory, { id }, { updatedAt: () => 'now()' });
      });
    } catch (error) {
      throw this.translate(error);
    }
    return this.getAdmin(id);
  }

  async setStatus(id: string, status: CategoryStatus): Promise<AdminCategory> {
    await this.dataSource.transaction(async (manager) => {
      const category = await this.lock(manager, id);
      if (category.status === status) return; // idempotent: no write
      await manager.update(ContentCategory, { id }, { status });
    });
    return this.getAdmin(id);
  }

  /**
   * Only an unused category is deleted (BD-3). The row lock orders this against a concurrent assignment: that
   * insert/update waits on the category's key lock, then fails its FK (the post side answers
   * CATEGORY_NOT_FOUND); an assignment that committed first is counted here.
   */
  async remove(id: string): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.lock(manager, id);
        const [{ used }] = await manager.query<{ used: boolean }[]>(
          'SELECT EXISTS (SELECT 1 FROM content_posts WHERE category_id = $1) AS used',
          [id],
        );
        if (used) throw new AppError(contentErrors.CATEGORY_IN_USE);
        await manager.delete(ContentCategory, { id }); // translations cascade
      });
    } catch (error) {
      throw isForeignKeyViolation(error, 'fk_content_posts_category_id')
        ? new AppError(contentErrors.CATEGORY_IN_USE)
        : error;
    }
  }

  private async lock(manager: EntityManager, id: string): Promise<ContentCategory> {
    const category = await manager.findOne(ContentCategory, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!category) throw new AppError(baselineErrors.NOT_FOUND);
    return category;
  }

  /** D11: this service gives the named unique violations their meaning (I15). */
  private translate(error: unknown): unknown {
    if (isUniqueViolation(error, 'uq_content_categories_key')) {
      return new AppError(contentErrors.CATEGORY_KEY_TAKEN);
    }
    if (isUniqueViolation(error, 'uq_content_category_translations_language_slug')) {
      return new AppError(contentErrors.CATEGORY_SLUG_TAKEN);
    }
    return error;
  }
}
