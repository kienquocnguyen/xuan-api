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
import { CourseSection } from './course-section.entity.js';

export const LESSON_STATUSES = ['draft', 'published'] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

/**
 * `course_lessons` (database.md §12). The id is the stable identity progress points to; moves change only
 * `section_id` and `position`, within the same course. The Vimeo reference never reaches a public response
 * and is never logged (course spec §8.2).
 */
@Entity('course_lessons')
@Unique('uq_course_lessons_section_id_position', ['sectionId', 'position'], {
  deferrable: 'INITIALLY DEFERRED',
})
@Check('ck_course_lessons_title_not_blank', `btrim("title") <> ''`)
@Check('ck_course_lessons_position_not_negative', `"position" >= 0`)
@Check('ck_course_lessons_status', `"status" IN ('draft', 'published')`)
@Check('ck_course_lessons_vimeo_video_id_format', `"vimeo_video_id" ~ '^[0-9]{1,20}$'`)
@Check('ck_course_lessons_vimeo_hash_format', `"vimeo_hash" ~ '^[A-Za-z0-9]{1,64}$'`)
@Check('ck_course_lessons_hash_needs_video', `"vimeo_hash" IS NULL OR "vimeo_video_id" IS NOT NULL`)
@Check('ck_course_lessons_duration_positive', `"duration_seconds" > 0`)
@Check(
  'ck_course_lessons_published_has_video',
  `"status" <> 'published' OR "vimeo_video_id" IS NOT NULL`,
)
export class CourseLesson {
  @PrimaryColumn({
    type: 'uuid',
    default: () => 'uuidv7()',
    primaryKeyConstraintName: 'pk_course_lessons',
  })
  id!: string;

  @Column({ name: 'section_id', type: 'uuid' })
  @ForeignKey(() => CourseSection, { name: 'fk_course_lessons_section_id', onDelete: 'RESTRICT' })
  sectionId!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'integer' })
  position!: number;

  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status!: LessonStatus;

  @Column({ name: 'vimeo_video_id', type: 'varchar', length: 20, nullable: true })
  vimeoVideoId!: string | null;

  @Column({ name: 'vimeo_hash', type: 'varchar', length: 64, nullable: true })
  vimeoHash!: string | null;

  @Column({ name: 'duration_seconds', type: 'integer', nullable: true })
  durationSeconds!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
