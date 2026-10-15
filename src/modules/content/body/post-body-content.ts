import type { PostBodyDocument, PostBodyMark } from './post-body.schema.js';

const VISIBLE_CHARACTER = /\S/u;

/**
 * Blog spec B18: publishable only if some text node, at any depth, has a non-whitespace character. Spaces,
 * tabs, newlines, no-break spaces, hard breaks and empty paragraphs/headings don't count. Iterative.
 */
export function hasMeaningfulText(doc: PostBodyDocument): boolean {
  const stack: unknown[] = [...doc.content];
  while (stack.length > 0) {
    const node = stack.pop() as { type: string; text?: string; content?: unknown[] };
    if (node.type === 'text' && VISIBLE_CHARACTER.test(node.text ?? '')) return true;
    if (Array.isArray(node.content)) stack.push(...node.content);
  }
  return false;
}

/**
 * Blog spec §4.1, canonical storage: link marks keep only `href` (the renderer decides `rel`/`target`);
 * nothing else changes. Returns a copy. Bodies are depth-limited before they get here.
 */
export function canonicalizePostBody(doc: PostBodyDocument): PostBodyDocument {
  return canonicalNode(doc) as PostBodyDocument;
}

function canonicalNode(node: unknown): unknown {
  const source = node as Record<string, unknown> & { content?: unknown[]; marks?: PostBodyMark[] };
  const copy: Record<string, unknown> = { ...source };
  if (Array.isArray(source.content)) copy.content = source.content.map(canonicalNode);
  if (Array.isArray(source.marks)) {
    copy.marks = source.marks.map((mark) =>
      mark.type === 'link' ? { type: 'link', attrs: { href: mark.attrs.href } } : { ...mark },
    );
  }
  return copy;
}
