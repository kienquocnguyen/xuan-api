import type { CourseLesson } from './course-lesson.entity.js';
import type { CourseSection } from './course-section.entity.js';
import type { CourseTree } from './course-tree.js';
import type { Course } from './course.entity.js';
import { locatePlayback } from './playback.js';

const lesson = (id: string) => ({ id }) as CourseLesson;
const section = (id: string) => ({ id }) as CourseSection;
const tree = (...sections: Array<[string, string[]]>): CourseTree => ({
  course: {} as Course,
  sections: sections.map(([id, lessonIds]) => ({
    section: section(id),
    lessons: lessonIds.map(lesson),
  })),
});

/** The published tree: section A holds l1, l2; section B holds l3. */
const published = tree(['A', ['l1', 'l2']], ['B', ['l3']]);

describe('locatePlayback', () => {
  it.each([
    ['the first lesson', 'l1', 'A', null, 'l2'],
    ['a lesson whose next lesson is in the next section', 'l2', 'A', 'l1', 'l3'],
    ['the last lesson', 'l3', 'B', 'l2', null],
  ])('finds %s and its neighbours across sections', (_case, id, sectionId, previous, next) => {
    expect(locatePlayback(published, id)).toEqual({
      lesson: lesson(id),
      section: section(sectionId),
      previousLessonId: previous,
      nextLessonId: next,
    });
  });

  it('gives null neighbours for a one-lesson course', () => {
    expect(locatePlayback(tree(['A', ['l1']]), 'l1')).toEqual({
      lesson: lesson('l1'),
      section: section('A'),
      previousLessonId: null,
      nextLessonId: null,
    });
  });

  it('returns null for a lesson that is not in the tree (a draft, or another course)', () => {
    expect(locatePlayback(published, 'l4')).toBeNull();
    expect(locatePlayback(tree(), 'l1')).toBeNull();
  });
});
