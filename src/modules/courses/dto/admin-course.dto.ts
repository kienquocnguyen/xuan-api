import { ApiProperty } from '@nestjs/swagger';
import { LESSON_STATUSES, type LessonStatus } from '../course-lesson.entity.js';
import type { AdminCourseListItem, CourseTree } from '../course-tree.js';
import { COURSE_STATUSES, type Course, type CourseStatus } from '../course.entity.js';

/** A course in the admin list (contract identifier, I19). */
export class AdminCourseSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'workflow-edit-video-youtube' }) slug!: string;
  @ApiProperty() title!: string;
  @ApiProperty() summary!: string;
  @ApiProperty({ enum: COURSE_STATUSES }) status!: CourseStatus;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) publishedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ example: 3 }) publishedLessonCount!: number;
  @ApiProperty({ example: 5 }) lessonCount!: number;
}

/** A lesson as the admin edits it, including its Vimeo reference (never on public DTOs). */
export class AdminCourseLessonDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ description: 'Informational; lists are in curriculum order.' }) position!: number;
  @ApiProperty({ enum: LESSON_STATUSES }) status!: LessonStatus;
  @ApiProperty({ type: String, nullable: true, example: '76979871' }) videoId!: string | null;
  @ApiProperty({ type: String, nullable: true }) privacyHash!: string | null;
  @ApiProperty({ type: Number, nullable: true, example: 600 }) durationSeconds!: number | null;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class AdminCourseSectionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ description: 'Informational; lists are in curriculum order.' }) position!: number;
  @ApiProperty({ type: [AdminCourseLessonDto] }) lessons!: AdminCourseLessonDto[];
}

/** A whole course as the admin authors it. Every curriculum write returns it. */
export class AdminCourseDto extends AdminCourseSummaryDto {
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: [AdminCourseSectionDto] }) sections!: AdminCourseSectionDto[];
}

/** Whitelist by construction: only these fields reach the wire (I10). */
export function toAdminCourseSummaryDto(item: AdminCourseListItem): AdminCourseSummaryDto {
  return summaryOf(item.course, item.lessonCount, item.publishedLessonCount);
}

/** Counts come from the tree itself, so they always agree with the sections shown. */
export function toAdminCourseDto(tree: CourseTree): AdminCourseDto {
  const lessons = tree.sections.flatMap((entry) => entry.lessons);
  const summary = summaryOf(
    tree.course,
    lessons.length,
    lessons.filter((lesson) => lesson.status === 'published').length,
  );
  return {
    id: summary.id,
    slug: summary.slug,
    title: summary.title,
    summary: summary.summary,
    status: summary.status,
    publishedAt: summary.publishedAt,
    updatedAt: summary.updatedAt,
    publishedLessonCount: summary.publishedLessonCount,
    lessonCount: summary.lessonCount,
    createdAt: tree.course.createdAt.toISOString(),
    sections: tree.sections.map(({ section, lessons: sectionLessons }) => ({
      id: section.id,
      title: section.title,
      position: section.position,
      lessons: sectionLessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        position: lesson.position,
        status: lesson.status,
        videoId: lesson.vimeoVideoId,
        privacyHash: lesson.vimeoHash,
        durationSeconds: lesson.durationSeconds,
        updatedAt: lesson.updatedAt.toISOString(),
      })),
    })),
  };
}

function summaryOf(
  course: Course,
  lessonCount: number,
  publishedLessonCount: number,
): AdminCourseSummaryDto {
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    summary: course.summary,
    status: course.status,
    publishedAt: course.publishedAt ? course.publishedAt.toISOString() : null,
    updatedAt: course.updatedAt.toISOString(),
    publishedLessonCount,
    lessonCount,
  };
}
