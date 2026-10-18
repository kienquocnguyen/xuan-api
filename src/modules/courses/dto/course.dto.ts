import { ApiProperty } from '@nestjs/swagger';
import type { Course } from '../course.entity.js';
import type { CourseTree } from '../course-tree.js';

// Public DTOs carry no video field (course spec §7, §14): the Vimeo reference is admin-only in outcome 1.

/** A published course in the catalog (contract identifier, I19). */
export class CourseSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'workflow-edit-video-youtube' }) slug!: string;
  @ApiProperty() title!: string;
  @ApiProperty() summary!: string;
  @ApiProperty({ format: 'date-time' }) publishedAt!: string;
}

export class CourseOutlineLessonDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: Number, nullable: true, example: 600 }) durationSeconds!: number | null;
}

export class CourseOutlineSectionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: [CourseOutlineLessonDto] }) lessons!: CourseOutlineLessonDto[];
}

/** A published course with its published outline: only published lessons, sections without one omitted. */
export class CourseDto extends CourseSummaryDto {
  @ApiProperty({ type: [CourseOutlineSectionDto] }) sections!: CourseOutlineSectionDto[];
}

/** Whitelist by construction: only these fields reach the wire (I10). Only published courses are mapped. */
export function toCourseSummaryDto(course: Course): CourseSummaryDto {
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    summary: course.summary,
    // ck_courses_published_has_date: a published course always has one.
    publishedAt: (course.publishedAt as Date).toISOString(),
  };
}

/** The tree must already hold only published lessons and non-empty sections (the service's `published` scope). */
export function toCourseDto(tree: CourseTree): CourseDto {
  const summary = toCourseSummaryDto(tree.course);
  return {
    id: summary.id,
    slug: summary.slug,
    title: summary.title,
    summary: summary.summary,
    publishedAt: summary.publishedAt,
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
