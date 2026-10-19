import {
  type PostBodyDocument,
  type PostBodyMark,
  postBodyV1DocumentSchema,
} from './post-body.schema.js';

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

/** Whether the version 1 allow-list accepts the document: the stored `body_version` (spec §5.5). */
export function fitsBodyVersion1(doc: PostBodyDocument): boolean {
  return postBodyV1DocumentSchema.safeParse(doc).success;
}

type Walked = {
  node: { type: string; attrs?: Record<string, unknown>; content?: unknown[] };
  path: string;
};

/** Every node with its request path (`body.content.3…`), iteratively. */
function walk(doc: PostBodyDocument): Walked[] {
  const out: Walked[] = [];
  const stack: Walked[] = doc.content.map(
    (node, i) => ({ node, path: `body.content.${i}` }) as Walked,
  );
  while (stack.length > 0) {
    const item = stack.shift() as Walked;
    out.push(item);
    const children = Array.isArray(item.node.content) ? item.node.content : [];
    stack.unshift(
      ...children.map((node, i) => ({ node, path: `${item.path}.content.${i}` }) as Walked),
    );
  }
  return out;
}

/** The media URLs a body uses, with their attribute paths; an unfinished before/after half ('') is skipped. */
export function collectMediaSources(doc: PostBodyDocument): { path: string; src: string }[] {
  const sources: { path: string; src: string }[] = [];
  for (const { node, path } of walk(doc)) {
    const attrs = node.attrs ?? {};
    if (node.type === 'image')
      sources.push({ path: `${path}.attrs.src`, src: attrs.src as string });
    if (node.type === 'beforeAfter') {
      for (const side of ['before', 'after'] as const) {
        if (attrs[side])
          sources.push({ path: `${path}.attrs.${side}`, src: attrs[side] as string });
      }
    }
  }
  return sources;
}

/** A before/after block still missing an image: allowed in drafts, never published (spec §5.5). */
export function hasIncompleteMedia(doc: PostBodyDocument): boolean {
  return walk(doc).some(
    ({ node }) =>
      node.type === 'beforeAfter' && (node.attrs?.before === '' || node.attrs?.after === ''),
  );
}
