import type { CourseLesson } from './course-lesson.entity.js';
import type { CourseSection } from './course-section.entity.js';
import type { CourseTree } from './course-tree.js';

export type LocatedPlayback = Readonly<{
  lesson: CourseLesson;
  section: CourseSection;
  previousLessonId: string | null;
  nextLessonId: string | null;
}>;

/**
 * Finds a lesson in a **published** tree with its neighbours in curriculum order, across sections (course spec
 * §11.6). Draft lessons aren't in that tree, so they are never a neighbour and never found (null → 404).
 */
export function locatePlayback(tree: CourseTree, lessonId: string): LocatedPlayback | null {
  const ordered = tree.sections.flatMap(({ section, lessons }) =>
    lessons.map((lesson) => ({ section, lesson })),
  );
  const index = ordered.findIndex(({ lesson }) => lesson.id === lessonId);
  if (index === -1) return null;
  return {
    lesson: ordered[index].lesson,
    section: ordered[index].section,
    previousLessonId: ordered[index - 1]?.lesson.id ?? null,
    nextLessonId: ordered[index + 1]?.lesson.id ?? null,
  };
}
