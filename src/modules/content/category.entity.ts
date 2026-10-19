import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export const CATEGORY_STATUSES = ['active', 'archived'] as const;
export type CategoryStatus = (typeof CATEGORY_STATUSES)[number];

/** The only V1 language for category names (as posts, spec B3b). */
export const CATEGORY_LANGUAGE = 'vi';

/** `content_categories` (database.md §12, blog completion spec §4.1): a stable key and a status. */
@Entity('content_categories')
@Unique('uq_content_categories_key', ['key'])
@Check('ck_content_categories_key_format', `"key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)
@Check('ck_content_categories_status', `"status" IN ('active', 'archived')`)
export class ContentCategory {
  @PrimaryColumn({
    type: 'uuid',
    default: () => 'uuidv7()',
    primaryKeyConstraintName: 'pk_content_categories',
  })
  id!: string;

  @Column({ type: 'varchar', length: 60 })
  key!: string;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: CategoryStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** `content_category_translations`: one slug and label per language (`vi` only in V1). */
@Entity('content_category_translations')
@Unique('uq_content_category_translations_language_slug', ['language', 'slug'])
@Unique('uq_content_category_translations_category_id_language', ['categoryId', 'language'])
@Check('ck_content_category_translations_language', `"language" IN ('vi')`)
@Check('ck_content_category_translations_slug_format', `"slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)
@Check('ck_content_category_translations_label_not_blank', `btrim("label") <> ''`)
export class ContentCategoryTranslation {
  @PrimaryColumn({
    type: 'uuid',
    default: () => 'uuidv7()',
    primaryKeyConstraintName: 'pk_content_category_translations',
  })
  id!: string;

  @Column({ name: 'category_id', type: 'uuid' })
  @ForeignKey(() => ContentCategory, {
    name: 'fk_content_category_translations_category_id',
    onDelete: 'CASCADE',
  })
  categoryId!: string;

  @Column({ type: 'varchar', length: 16, default: CATEGORY_LANGUAGE })
  language!: string;

  @Column({ type: 'varchar', length: 80 })
  slug!: string;

  @Column({ type: 'varchar', length: 60 })
  label!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
