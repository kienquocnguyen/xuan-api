import type { CurriculumOrderInput } from './dto/save-course.dto.js';

/** Every section and lesson id the course has right now, in any order (read under the course lock). */
export type CurriculumSnapshot = Readonly<{
  sectionIds: readonly string[];
  lessonIds: readonly string[];
}>;

/**
 * A requested order is complete when it lists every section and every lesson of the course exactly once,
 * and nothing else (course spec §10.3). Anything less is `CURRICULUM_ORDER_MISMATCH`, never a partial reorder.
 */
export function isCompleteCurriculumOrder(
  current: CurriculumSnapshot,
  requested: CurriculumOrderInput,
): boolean {
  const sectionIds = requested.sections.map((section) => section.id);
  const lessonIds = requested.sections.flatMap((section) => section.lessonIds);
  return sameIdsOnce(sectionIds, current.sectionIds) && sameIdsOnce(lessonIds, current.lessonIds);
}

/** `requested` holds no duplicate and exactly the ids of `current`. */
function sameIdsOnce(requested: readonly string[], current: readonly string[]): boolean {
  const unique = new Set(requested);
  if (unique.size !== requested.length || unique.size !== current.length) return false;
  return current.every((id) => unique.has(id));
}
