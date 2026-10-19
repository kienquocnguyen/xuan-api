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
import { CourseLesson } from './course-lesson.entity.js';

/**
 * `lesson_progress` (database.md §12): one row per (user, lesson), written by one upsert (course spec §9.2).
 * Self-reported learning state, kept on revocation and unpublish. The user FK is declared by entity name
 * (AD14, I2); `RESTRICT` on the lesson makes a lesson with progress undeletable (409 LESSON_HAS_PROGRESS).
 */
@Entity('lesson_progress')
@Unique('uq_lesson_progress_user_id_lesson_id', ['userId', 'lessonId'])
@Index('ix_lesson_progress_lesson_id', ['lessonId'])
@Check('ck_lesson_progress_position_not_negative', `"position_seconds" >= 0`)
export class LessonProgress {
  @PrimaryColumn({
    type: 'uuid',
    default: () => 'uuidv7()',
    primaryKeyConstraintName: 'pk_lesson_progress',
  })
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @ForeignKey('User', { name: 'fk_lesson_progress_user_id', onDelete: 'RESTRICT' })
  userId!: string;

  @Column({ name: 'lesson_id', type: 'uuid' })
  @ForeignKey(() => CourseLesson, { name: 'fk_lesson_progress_lesson_id', onDelete: 'RESTRICT' })
  lessonId!: string;

  @Column({ name: 'position_seconds', type: 'integer' })
  positionSeconds!: number;

  /** Sticky: the upsert keeps the first value. */
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'last_watched_at', type: 'timestamptz', default: () => 'now()' })
  lastWatchedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
