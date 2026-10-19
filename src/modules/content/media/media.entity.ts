import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  Unique,
} from 'typeorm';

/** Every stored variant is re-encoded to WebP (blog completion spec §5.1). */
export const MEDIA_CONTENT_TYPE = 'image/webp';

/**
 * `content_media` (database.md §12, spec §5.2): one uploaded image, stored as `<storageKey>-<width>.webp` for
 * each of `variantWidths`. Never changes and never deleted in V1 (BD-5). The uploader FK is declared by entity
 * name (AD14).
 */
@Entity('content_media')
@Unique('uq_content_media_storage_key', ['storageKey'])
@Index('ix_content_media_uploader_id', ['uploaderId'])
@Check('ck_content_media_storage_key_format', `"storage_key" ~ '^blog/[0-9a-f-]{36}$'`)
@Check('ck_content_media_content_type', `"content_type" IN ('image/webp')`)
@Check('ck_content_media_dimensions', `"width" BETWEEN 1 AND 6000 AND "height" BETWEEN 1 AND 6000`)
@Check('ck_content_media_variant_widths_not_empty', `cardinality("variant_widths") >= 1`)
@Check('ck_content_media_byte_size_positive', `"byte_size" > 0`)
export class ContentMedia {
  @PrimaryColumn({
    type: 'uuid',
    default: () => 'uuidv7()',
    primaryKeyConstraintName: 'pk_content_media',
  })
  id!: string;

  @Column({ name: 'uploader_id', type: 'uuid' })
  @ForeignKey('User', { name: 'fk_content_media_uploader_id', onDelete: 'RESTRICT' })
  uploaderId!: string;

  @Column({ name: 'storage_key', type: 'varchar', length: 80 })
  storageKey!: string;

  @Column({ name: 'content_type', type: 'varchar', length: 32, default: MEDIA_CONTENT_TYPE })
  contentType!: string;

  /** Of the largest variant. */
  @Column({ type: 'integer' })
  width!: number;

  @Column({ type: 'integer' })
  height!: number;

  @Column({ name: 'variant_widths', type: 'smallint', array: true })
  variantWidths!: number[];

  @Column({ name: 'byte_size', type: 'integer' })
  byteSize!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
