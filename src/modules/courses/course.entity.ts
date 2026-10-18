import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export const COURSE_STATUSES = ['draft', 'published'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

/**
 * `courses` (database.md §12). "A published course has at least one published lesson" spans tables, so no
 * constraint here holds it: the course lock rule L1 does (AD15, course spec §10.6).
 */
@Entity('courses')
@Unique('uq_courses_slug', ['slug'])
@Check('ck_courses_slug_format', `"slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)
@Check('ck_courses_title_not_blank', `btrim("title") <> ''`)
@Check('ck_courses_summary_not_blank', `btrim("summary") <> ''`)
@Check('ck_courses_status', `"status" IN ('draft', 'published')`)
@Check('ck_courses_published_has_date', `"status" <> 'published' OR "published_at" IS NOT NULL`)
export class Course {
  @PrimaryColumn({
    type: 'uuid',
    default: () => 'uuidv7()',
    primaryKeyConstraintName: 'pk_courses',
  })
  id!: string;

  @Column({ type: 'varchar', length: 160 })
  slug!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'varchar', length: 500 })
  summary!: string;

  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status!: CourseStatus;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
