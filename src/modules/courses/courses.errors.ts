import type { ErrorDefinition } from '../../errors/app-error.js';

/** Courses-module error codes (D10; course spec §11.5): outcome 1's conflicts, outcome 2's access refusal. */
export const coursesErrors = {
  COURSE_SLUG_TAKEN: {
    code: 'COURSE_SLUG_TAKEN',
    kind: 'conflict',
    message: 'Another course already uses this slug.',
  },
  COURSE_SLUG_LOCKED: {
    code: 'COURSE_SLUG_LOCKED',
    kind: 'conflict',
    message: 'A published course keeps its slug.',
  },
  COURSE_NEEDS_PUBLISHED_LESSON: {
    code: 'COURSE_NEEDS_PUBLISHED_LESSON',
    kind: 'conflict',
    message: 'A published course needs at least one published lesson.',
  },
  LESSON_VIDEO_MISSING: {
    code: 'LESSON_VIDEO_MISSING',
    kind: 'conflict',
    message: 'A published lesson needs a Vimeo video.',
  },
  LESSON_IS_PUBLISHED: {
    code: 'LESSON_IS_PUBLISHED',
    kind: 'conflict',
    message: 'Unpublish the lesson before deleting it.',
  },
  SECTION_NOT_EMPTY: {
    code: 'SECTION_NOT_EMPTY',
    kind: 'conflict',
    message: 'Move or delete the lessons in this section first.',
  },
  CURRICULUM_ORDER_MISMATCH: {
    code: 'CURRICULUM_ORDER_MISMATCH',
    kind: 'conflict',
    message: 'The order must list every section and lesson of the course exactly once.',
  },
  COURSE_ACCESS_REQUIRED: {
    code: 'COURSE_ACCESS_REQUIRED',
    kind: 'forbidden',
    message: 'You need access to this course.',
  },
} as const satisfies Record<string, ErrorDefinition>;
