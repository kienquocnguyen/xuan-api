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
import { Course } from './course.entity.js';

/**
 * `course_sections` (database.md §12). `course_id` never changes. The position unique is checked at commit
 * (spike S7), so a reorder is a run of plain updates in one transaction. FK metadata, no relation: queries
 * join explicitly (D37, D38).
 */
@Entity('course_sections')
@Unique('uq_course_sections_course_id_position', ['courseId', 'position'], {
  deferrable: 'INITIALLY DEFERRED',
})
@Check('ck_course_sections_title_not_blank', `btrim("title") <> ''`)
@Check('ck_course_sections_position_not_negative', `"position" >= 0`)
export class CourseSection {
  @PrimaryColumn({
    type: 'uuid',
    default: () => 'uuidv7()',
    primaryKeyConstraintName: 'pk_course_sections',
  })
  id!: string;

  @Column({ name: 'course_id', type: 'uuid' })
  @ForeignKey(() => Course, { name: 'fk_course_sections_course_id', onDelete: 'RESTRICT' })
  courseId!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'integer' })
  position!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
