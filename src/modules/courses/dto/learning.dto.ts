import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import type { CourseTree, LearnerCourseListItem } from '../course-tree.js';
import type { LocatedPlayback } from '../playback.js';
import { CourseSummaryDto, toCourseSummaryDto } from './course.dto.js';

// Learner DTOs are separate classes from the public outline, so outcome 3 only adds fields (course spec §11.6).
// LessonPlaybackDto and VimeoVideoDto are the only response classes with a video field (§7, §14).

/** The slug is an opaque lookup key (the posts/services D7 deviation); the lesson id is a uuid (D9). */
export const lessonPathParamsSchema = z
  .strictObject({ slug: z.string(), lessonId: z.uuid() })
  .meta({ id: 'LessonPathParams' });
export type LessonPathParams = z.infer<typeof lessonPathParamsSchema>;

export class LearnerCourseSummaryDto {
  @ApiProperty({ type: CourseSummaryDto }) course!: CourseSummaryDto;
  @ApiProperty({ description: 'Published lessons in the course.', example: 12 })
  totalLessons!: number;
}

export class LearnerCourseLessonDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: Number, nullable: true, example: 600 }) durationSeconds!: number | null;
}

export class LearnerCourseSectionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: [LearnerCourseLessonDto] }) lessons!: LearnerCourseLessonDto[];
}

export class LearnerCourseDto {
  @ApiProperty({ type: CourseSummaryDto }) course!: CourseSummaryDto;
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
}

export function toLearnerCourseSummaryDto(item: LearnerCourseListItem): LearnerCourseSummaryDto {
  return { course: toCourseSummaryDto(item.course), totalLessons: item.totalLessons };
}

/** The tree must be the published one: only published lessons, non-empty sections. No video field (I10). */
export function toLearnerCourseDto(tree: CourseTree): LearnerCourseDto {
  return {
    course: toCourseSummaryDto(tree.course),
    sections: tree.sections.map(({ section, lessons }) => ({
      id: section.id,
      title: section.title,
      lessons: lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        durationSeconds: lesson.durationSeconds,
      })),
    })),
  };
}

export function toLessonPlaybackDto(located: LocatedPlayback): LessonPlaybackDto {
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
  };
}
