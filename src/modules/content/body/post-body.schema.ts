import { z } from 'zod';
import { checkPostBodyLimits } from './post-body-limits.js';
import { isSafeLinkHref } from './post-body-links.js';
import { isStorableText, STORABLE_TEXT_MESSAGE } from './storable-text.js';

// Body version 1 (blog spec §4.1): a text-first TipTap 3 / ProseMirror document. Explicit types keep
// TypeScript's inference finite across the recursive schemas below.
export type PostBodyMark =
  | { type: 'bold' }
  | { type: 'italic' }
  | {
      type: 'link';
      attrs: {
        href: string;
        target?: '_blank' | null;
        rel?: 'noopener noreferrer nofollow' | null;
        class?: null;
        title?: null;
      };
    };
export type PostBodyInline =
  | { type: 'text'; text: string; marks?: PostBodyMark[] }
  | { type: 'hardBreak'; marks?: PostBodyMark[] };
export type PostBodyListItem = { type: 'listItem'; content: PostBodyNode[] };
export type PostBodyNode =
  | { type: 'paragraph'; content?: PostBodyInline[] }
  | { type: 'heading'; attrs: { level: 2 | 3 }; content?: PostBodyInline[] }
  | { type: 'bulletList'; content: PostBodyListItem[] }
  | { type: 'orderedList'; attrs?: { start: number; type?: null }; content: PostBodyListItem[] }
  | { type: 'blockquote'; content: PostBodyNode[] };
export type PostBodyDocument = { type: 'doc'; content: PostBodyNode[] };

const markSchema = z
  .discriminatedUnion('type', [
    z.strictObject({ type: z.literal('bold') }),
    z.strictObject({ type: z.literal('italic') }),
    z.strictObject({
      type: z.literal('link'),
      attrs: z.strictObject({
        href: z
          .string()
          .max(2048)
          .refine(isSafeLinkHref, 'Links must be absolute https, http or mailto URLs.')
          .refine(isStorableText, STORABLE_TEXT_MESSAGE),
        // TipTap 3.28's defaults are accepted only with their default values, then stripped on save.
        target: z.literal('_blank').nullable().optional(),
        rel: z.literal('noopener noreferrer nofollow').nullable().optional(),
        class: z.null().optional(),
        title: z.null().optional(),
      }),
    }),
  ])
  .meta({ id: 'PostBodyMark' });

const marksSchema = z
  .array(markSchema)
  .max(3)
  .refine(
    (marks) => new Set(marks.map((mark) => mark.type)).size === marks.length,
    'Each mark may appear only once.',
  );

const inlineSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('text'),
    text: z.string().min(1).max(10_000).refine(isStorableText, STORABLE_TEXT_MESSAGE),
    marks: marksSchema.optional(),
  }),
  z.strictObject({ type: z.literal('hardBreak'), marks: marksSchema.optional() }),
]);

const paragraphSchema = z.strictObject({
  type: z.literal('paragraph'),
  content: z.array(inlineSchema).optional(),
});

const listItemSchema = z.strictObject({
  type: z.literal('listItem'),
  get content(): z.ZodType<PostBodyNode[]> {
    return z
      .array(postBodyNodeSchema)
      .min(1)
      .refine((nodes) => nodes[0]?.type === 'paragraph', 'A list item starts with a paragraph.');
  },
});

export const postBodyNodeSchema: z.ZodType<PostBodyNode> = z
  .discriminatedUnion('type', [
    paragraphSchema,
    z.strictObject({
      type: z.literal('heading'),
      attrs: z.strictObject({ level: z.union([z.literal(2), z.literal(3)]) }),
      content: z.array(inlineSchema).optional(),
    }),
    z.strictObject({ type: z.literal('bulletList'), content: z.array(listItemSchema).min(1) }),
    z.strictObject({
      type: z.literal('orderedList'),
      attrs: z
        .strictObject({ start: z.number().int().min(1).max(100_000), type: z.null().optional() })
        .optional(),
      content: z.array(listItemSchema).min(1),
    }),
    z.strictObject({
      type: z.literal('blockquote'),
      get content(): z.ZodType<PostBodyNode[]> {
        return z.array(postBodyNodeSchema).min(1);
      },
    }),
  ])
  .meta({ id: 'PostBodyNode' });

export const postBodyDocumentSchema = z
  .strictObject({ type: z.literal('doc'), content: z.array(postBodyNodeSchema) })
  .meta({ id: 'PostBodyDocument' });

/**
 * The request field: the iterative limits pass first; when it adds an issue, Zod skips the recursive schema,
 * so a pathological document never reaches it (blog spec §4.3).
 */
export const postBodyInputSchema = z.preprocess((value, ctx) => {
  for (const issue of checkPostBodyLimits(value)) {
    ctx.addIssue({ code: 'custom', message: issue.message, input: value });
  }
  return value;
}, postBodyDocumentSchema);
