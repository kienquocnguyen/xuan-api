import type { CourseLesson } from './course-lesson.entity.js';
import type { CourseSection } from './course-section.entity.js';
import type { Course } from './course.entity.js';

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
