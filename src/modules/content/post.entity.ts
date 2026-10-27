import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { PostBodyDocument } from './body/post-body.schema.js';
import { ContentCategory } from './category.entity.js';
import { ContentMedia } from './media/media.entity.js';

export const POST_STATUSES = ['draft', 'published', 'archived'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** The only V1 language (spec B3): widening `ck_content_posts_language` is the i18n change. */
export const POST_LANGUAGE = 'vi';

/**
 * `content_posts` (database.md §12). The author FK is declared by entity name, so this module never imports the
 * users module's entity (spec B7, I2); TypeORM still knows the FK, so generated migrations keep it.
 */
@Entity('content_posts')
@Unique('uq_content_posts_language_slug', ['language', 'slug'])
@Index('ix_content_posts_language_status_published_at_id', [
  'language',
  'status',
  'publishedAt',
  'id',
])
@Index('ix_content_posts_author_id_updated_at_id', ['authorId', 'updatedAt', 'id'])
@Index('ix_content_posts_cover_media_id', ['coverMediaId'])
@Index('ix_content_posts_og_media_id', ['ogMediaId'])
@Index('ix_content_posts_category_id_status_published_at_id', [
  'categoryId',
  'status',
  'publishedAt',
  'id',
])
@Check('ck_content_posts_language', `"language" IN ('vi')`)
@Check('ck_content_posts_slug_format', `"slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)
@Check('ck_content_posts_title_not_blank', `btrim("title") <> ''`)
@Check('ck_content_posts_excerpt_not_blank', `"excerpt" IS NULL OR btrim("excerpt") <> ''`)
@Check('ck_content_posts_seo_title_not_blank', `"seo_title" IS NULL OR btrim("seo_title") <> ''`)
@Check(
  'ck_content_posts_seo_description_not_blank',
  `"seo_description" IS NULL OR btrim("seo_description") <> ''`,
)
@Check(
  'ck_content_posts_body_is_doc',
  `jsonb_typeof("body") = 'object' AND "body"->>'type' = 'doc'`,
)
@Check('ck_content_posts_body_version', `"body_version" IN (1, 2)`)
@Check(
  'ck_content_posts_cover_alt',
  `("cover_media_id" IS NULL AND "cover_alt" IS NULL) OR ("cover_media_id" IS NOT NULL AND "cover_alt" IS NOT NULL AND btrim("cover_alt") <> '')`,
)
@Check('ck_content_posts_status', `"status" IN ('draft', 'published', 'archived')`)
@Check('ck_content_posts_tags_count', `cardinality("tags") <= 10`)
@Check(
  'ck_content_posts_published_has_date',
  `"status" <> 'published' OR "published_at" IS NOT NULL`,
)
export class Post {
  @PrimaryColumn({
    type: 'uuid',
    default: () => 'uuidv7()',
    primaryKeyConstraintName: 'pk_content_posts',
  })
  id!: string;

  @Column({ name: 'author_id', type: 'uuid' })
  @ForeignKey('User', { name: 'fk_content_posts_author_id', onDelete: 'RESTRICT' })
  authorId!: string;

  @Column({ type: 'varchar', length: 16, default: POST_LANGUAGE })
  language!: string;

  @Column({ type: 'varchar', length: 160 })
  slug!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'varchar', length: 400, nullable: true })
  excerpt!: string | null;

  @Column({ type: 'jsonb' })
  body!: PostBodyDocument;

  @Column({ name: 'body_version', type: 'smallint', default: 1 })
  bodyVersion!: number;

  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status!: PostStatus;

  /** Up to 10 labels in the author's order (blog completion B1); element rules are the API's (database.md §12). */
  @Column({ type: 'varchar', length: 40, array: true, default: () => "'{}'" })
  tags!: string[];

  /** One category per post (blog completion B2); required to publish, absent on legacy posts (database.md §12). */
  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  @ForeignKey(() => ContentCategory, { name: 'fk_content_posts_category_id', onDelete: 'RESTRICT' })
  categoryId!: string | null;

  /** Blog completion B3: the cover (alt required with it) and the social-share override. */
  @Column({ name: 'cover_media_id', type: 'uuid', nullable: true })
  @ForeignKey(() => ContentMedia, { name: 'fk_content_posts_cover_media_id', onDelete: 'RESTRICT' })
  coverMediaId!: string | null;

  @Column({ name: 'cover_alt', type: 'varchar', length: 200, nullable: true })
  coverAlt!: string | null;

  @Column({ name: 'og_media_id', type: 'uuid', nullable: true })
  @ForeignKey(() => ContentMedia, { name: 'fk_content_posts_og_media_id', onDelete: 'RESTRICT' })
  ogMediaId!: string | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({ name: 'seo_title', type: 'varchar', length: 200, nullable: true })
  seoTitle!: string | null;

  @Column({ name: 'seo_description', type: 'varchar', length: 400, nullable: true })
  seoDescription!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
