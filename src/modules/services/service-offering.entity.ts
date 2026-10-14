import { Check, Column, CreateDateColumn, Entity, PrimaryColumn, Unique } from 'typeorm';

/** The `services` table (database.md §12). Business word: "service"; class name avoids clashing with Nest services. */
@Entity('services')
@Unique('uq_services_slug', ['slug'])
@Check('ck_services_slug_format', `"slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)
@Check('ck_services_title_not_blank', `btrim("title") <> ''`)
@Check('ck_services_summary_not_blank', `btrim("summary") <> ''`)
export class ServiceOffering {
  @PrimaryColumn({
    type: 'uuid',
    default: () => 'uuidv7()',
    primaryKeyConstraintName: 'pk_services',
  })
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  slug!: string;

  @Column({ type: 'varchar', length: 120 })
  title!: string;

  @Column({ type: 'varchar', length: 500 })
  summary!: string;

  @Column({ name: 'is_published', type: 'boolean', default: false })
  isPublished!: boolean;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
