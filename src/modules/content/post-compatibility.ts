import type { Post } from './post.entity.js';

/**
 * Fields added after Blog V1. An old client omits them, so a full replacement would erase what a newer client
 * stored (blog completion spec §3.4, owner Q3). Later outcomes add their fields here.
 */
const GUARDED: readonly { field: string; hasData: (post: Post) => boolean }[] = [
  { field: 'tags', hasData: (post) => post.tags.length > 0 },
  { field: 'categoryId', hasData: (post) => post.categoryId !== null },
];

/** The guarded fields absent from `input` whose stored value isn't empty; empty means the request is safe. */
export function omittedFieldsWithData(
  input: Readonly<Record<string, unknown>>,
  post: Post,
): string[] {
  return GUARDED.filter(({ field, hasData }) => !(field in input) && hasData(post)).map(
    ({ field }) => field,
  );
}
