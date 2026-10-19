import type { CourseLesson } from './course-lesson.entity.js';
import type { CourseSection } from './course-section.entity.js';
import type { Course } from './course.entity.js';
import type { LessonProgress } from './lesson-progress.entity.js';

/** A course with its sections and their lessons, each list in curriculum order. Shared by the service and mappers. */
export type CourseTree = Readonly<{
  course: Course;
  sections: ReadonlyArray<Readonly<{ section: CourseSection; lessons: readonly CourseLesson[] }>>;
}>;

/** A course in the admin list, with its lesson counts from one grouped query. */
export type AdminCourseListItem = Readonly<{
  course: Course;
  lessonCount: number;
  publishedLessonCount: number;
}>;

/** A learner's own progress rows in one course, by lesson id (course spec §9). */
export type ProgressByLesson = ReadonlyMap<string, LessonProgress>;

/** A published course as one learner sees it: its published tree, their progress and the resume lesson (§9.4). */
export type LearnerCourseView = Readonly<{
  tree: CourseTree;
  progress: ProgressByLesson;
  resumeLessonId: string;
}>;
