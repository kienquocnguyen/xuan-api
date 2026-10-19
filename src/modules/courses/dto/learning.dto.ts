import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import type { LearnerCourseView } from '../course-tree.js';
import type { PlaybackView } from '../learning.service.js';
import { clampPosition, type ProgressState } from '../progress.js';
import { CourseSummaryDto, toCourseSummaryDto } from './course.dto.js';

// Learner DTOs are separate classes from the public outline, so outcome 3 only adds fields (course spec §11.6).
// LessonPlaybackDto and VimeoVideoDto are the only response classes with a video field (§7, §14).

/** The slug is an opaque lookup key (the posts/services D7 deviation); the lesson id is a uuid (D9). */
export const lessonPathParamsSchema = z
  .strictObject({ slug: z.string(), lessonId: z.uuid() })
  .meta({ id: 'LessonPathParams' });
export type LessonPathParams = z.infer<typeof lessonPathParamsSchema>;

/** A learner's progress in one lesson (outcome 3, additive). Zeros and `false` when nothing was saved yet. */
export class LessonProgressDto {
  @ApiProperty({
    type: 'integer',
    example: 120,
    description: 'Clamped to the lesson duration when known.',
  })
  positionSeconds!: number;
  @ApiProperty() completed!: boolean;
}

/** Read clamping (spec §9.6): never written back, so a later duration increase shows the saved value again. */
export function toLessonProgressDto(
  row: (ProgressState & { positionSeconds: number }) | undefined,
  durationSeconds: number | null,
): LessonProgressDto {
  if (!row) return { positionSeconds: 0, completed: false };
  return {
    positionSeconds: clampPosition(row.positionSeconds, durationSeconds),
    completed: row.completedAt !== null,
  };
}

export class LearnerCourseSummaryDto {
  @ApiProperty({ type: CourseSummaryDto }) course!: CourseSummaryDto;
  @ApiProperty({ description: 'Published lessons in the course.', example: 12 })
  totalLessons!: number;
  @ApiProperty({ description: 'Published lessons the learner completed.', example: 3 })
  completedLessons!: number;
  @ApiProperty({ format: 'uuid', description: 'The published lesson to continue with.' })
  resumeLessonId!: string;
}

export class LearnerCourseLessonDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: Number, nullable: true, example: 600 }) durationSeconds!: number | null;
  @ApiProperty({ type: LessonProgressDto }) progress!: LessonProgressDto;
}

export class LearnerCourseSectionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: [LearnerCourseLessonDto] }) lessons!: LearnerCourseLessonDto[];
}

export class LearnerCourseDto {
  @ApiProperty({ type: CourseSummaryDto }) course!: CourseSummaryDto;
  @ApiProperty({ format: 'uuid', description: 'The published lesson to continue with.' })
  resumeLessonId!: string;
  @ApiProperty({ type: [LearnerCourseSectionDto] }) sections!: LearnerCourseSectionDto[];
}

/** The parts the web's Vimeo player needs: `id`, or `url` with `h` when a privacy hash is set (spec §8.2). */
export class VimeoVideoDto {
  @ApiProperty({ enum: ['vimeo'] }) provider!: 'vimeo';
  @ApiProperty({ example: '76979871' }) videoId!: string;
  @ApiProperty({ type: String, nullable: true }) privacyHash!: string | null;
}

export class LessonPlaybackDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() sectionTitle!: string;
  @ApiProperty({ type: Number, nullable: true, example: 600 }) durationSeconds!: number | null;
  @ApiProperty({ type: VimeoVideoDto }) video!: VimeoVideoDto;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) previousLessonId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) nextLessonId!: string | null;
  @ApiProperty({ type: LessonProgressDto }) progress!: LessonProgressDto;
}

/** Counts and resume are over published lessons only; the view's progress holds only those (spec §10.2). */
export function toLearnerCourseSummaryDto(view: LearnerCourseView): LearnerCourseSummaryDto {
  const lessons = view.tree.sections.flatMap((entry) => entry.lessons);
  return {
    course: toCourseSummaryDto(view.tree.course),
    totalLessons: lessons.length,
    completedLessons: lessons.filter((lesson) => view.progress.get(lesson.id)?.completedAt != null)
      .length,
    resumeLessonId: view.resumeLessonId,
  };
}

/** The tree must be the published one: only published lessons, non-empty sections. No video field (I10). */
export function toLearnerCourseDto(view: LearnerCourseView): LearnerCourseDto {
  return {
    course: toCourseSummaryDto(view.tree.course),
    resumeLessonId: view.resumeLessonId,
    sections: view.tree.sections.map(({ section, lessons }) => ({
      id: section.id,
      title: section.title,
      lessons: lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        durationSeconds: lesson.durationSeconds,
        progress: toLessonProgressDto(view.progress.get(lesson.id), lesson.durationSeconds),
      })),
    })),
  };
}

export function toLessonPlaybackDto({ located, progress }: PlaybackView): LessonPlaybackDto {
  const { lesson, section } = located;
  return {
    id: lesson.id,
    title: lesson.title,
    sectionTitle: section.title,
    durationSeconds: lesson.durationSeconds,
    // ck_course_lessons_published_has_video: a published lesson always has one.
    video: {
      provider: 'vimeo',
      videoId: lesson.vimeoVideoId as string,
      privacyHash: lesson.vimeoHash,
    },
    previousLessonId: located.previousLessonId,
    nextLessonId: located.nextLessonId,
    progress: toLessonProgressDto(progress, lesson.durationSeconds),
  };
}
