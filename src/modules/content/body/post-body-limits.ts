/** Blog spec §4.3. */
export const POST_BODY_LIMITS = { maxBytes: 256 * 1024, maxNodes: 5_000, maxDepth: 12 } as const;

export type LimitIssue = { message: string };

/**
 * Size, depth and node-count checks that run **before** the recursive schema: they're iterative, so a
 * pathologically deep document can't overflow the stack (a plain recursive parse throws `RangeError`, a 500).
 * Only `content` arrays are walked; shape errors are the schema's job. The doc itself is depth 0 and one node.
 */
export function checkPostBodyLimits(value: unknown): LimitIssue[] {
  if (typeof value !== 'object' || value === null) return [];
  let nodes = 0;
  const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > POST_BODY_LIMITS.maxDepth)
      return [{ message: 'The document is nested too deeply.' }];
    if (typeof node !== 'object' || node === null) continue;
    nodes += 1;
    if (nodes > POST_BODY_LIMITS.maxNodes) return [{ message: 'The document has too many nodes.' }];
    const content = (node as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const child of content) stack.push({ node: child, depth: depth + 1 });
    }
  }
  // Safe now: depth is bounded, so JSON.stringify can't recurse deeply.
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > POST_BODY_LIMITS.maxBytes) {
    return [{ message: 'The document is too large.' }];
  }
  return [];
}
