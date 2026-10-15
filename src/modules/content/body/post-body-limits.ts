/** Blog spec §4.3. */
export const POST_BODY_LIMITS = { maxBytes: 256 * 1024, maxNodes: 5_000, maxDepth: 12 } as const;

/**
 * Raw JSON nesting allowed anywhere: the deepest legitimate value (a link mark's `attrs` on a text node at
 * `maxDepth`) sits at 2 × maxDepth + 4 (doc → content → node → … → marks → mark → attrs); 2 of slack.
 */
const MAX_RAW_DEPTH = 2 * POST_BODY_LIMITS.maxDepth + 6;

export type LimitIssue = { message: string };

const TOO_DEEP: LimitIssue = { message: 'The document is nested too deeply.' };

type Entry = { value: unknown; raw: number; node: number | null };

/**
 * Size, depth and node-count checks that run **before** the recursive schema. Iterative and over **every**
 * object and array (not only `content`), so no shape of deep nesting can overflow the stack: a recursive
 * parse or `JSON.stringify` would throw `RangeError`, a 500. Node depth counts nodes reached through
 * `content` (the doc is depth 0 and one node); raw depth bounds everything else. Shape errors are the
 * schema's job.
 */
export function checkPostBodyLimits(value: unknown): LimitIssue[] {
  if (typeof value !== 'object' || value === null) return [];
  let nodes = 0;
  const stack: Entry[] = [{ value, raw: 1, node: 0 }];
  while (stack.length > 0) {
    const { value: current, raw, node } = stack.pop()!;
    if (typeof current !== 'object' || current === null) continue;
    if (raw > MAX_RAW_DEPTH) return [TOO_DEEP];
    if (node !== null) {
      if (node > POST_BODY_LIMITS.maxDepth) return [TOO_DEEP];
      nodes += 1;
      if (nodes > POST_BODY_LIMITS.maxNodes)
        return [{ message: 'The document has too many nodes.' }];
    }
    if (Array.isArray(current)) {
      for (const item of current) stack.push({ value: item, raw: raw + 1, node: null });
      continue;
    }
    for (const [key, child] of Object.entries(current)) {
      if (node !== null && key === 'content' && Array.isArray(child)) {
        // A node's children are nodes one level deeper; the array itself is one raw level.
        if (raw + 1 > MAX_RAW_DEPTH) return [TOO_DEEP];
        for (const item of child) stack.push({ value: item, raw: raw + 2, node: node + 1 });
      } else {
        stack.push({ value: child, raw: raw + 1, node: null });
      }
    }
  }
  // Safe now: every value is at most MAX_RAW_DEPTH deep, so JSON.stringify can't recurse deeply.
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > POST_BODY_LIMITS.maxBytes) {
    return [{ message: 'The document is too large.' }];
  }
  return [];
}
