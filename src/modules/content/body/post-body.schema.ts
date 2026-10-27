import { z } from 'zod';
import { checkPostBodyLimits } from './post-body-limits.js';
import { isSafeLinkHref, isSafeLinkHrefV2 } from './post-body-links.js';
import { isStorableText, STORABLE_TEXT_MESSAGE } from '../../../http/validation/storable-text.js';

// The TipTap 3 / ProseMirror body. Version 1 (blog spec §4.1) is text-first; version 2 (blog completion spec
// §5.5) is a strict superset. The named components (PostBodyDocument/Node/Mark) describe version 2; version 1
// stays as the gate for requests that declare it. Explicit types keep inference finite across recursion.

type LinkAttrs = {
  href: string;
  target?: '_blank' | null;
  rel?: 'noopener noreferrer nofollow' | null;
  class?: null;
  title?: null;
};
export type PostBodyMark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'underline' }
  | { type: 'strike' }
  | { type: 'code' }
  | { type: 'link'; attrs: LinkAttrs };
export type PostBodyInline =
  | { type: 'text'; text: string; marks?: PostBodyMark[] }
  | { type: 'hardBreak'; marks?: PostBodyMark[] };
export type PostBodyListItem = { type: 'listItem'; content: PostBodyNode[] };
export type PostBodyNode =
  | { type: 'paragraph'; content?: PostBodyInline[] }
  | { type: 'heading'; attrs: { level: 2 | 3 }; content?: PostBodyInline[] }
  | { type: 'bulletList'; content: PostBodyListItem[] }
  | { type: 'orderedList'; attrs?: { start: number; type?: null }; content: PostBodyListItem[] }
  | { type: 'blockquote'; content: PostBodyNode[] }
  | {
      type: 'image';
      attrs: { src: string; alt: string; title?: string | null; width: number; height: number };
    }
  | {
      type: 'beforeAfter';
      attrs: {
        before: string;
        after: string;
        beforeAlt: string;
        afterAlt: string;
        caption: string;
        initial: number;
        width: number;
        height: number;
      };
    }
  | { type: 'horizontalRule' }
  | {
      type: 'codeBlock';
      attrs?: { language: CodeLanguage | null };
      content?: { type: 'text'; text: string }[];
    }
  | {
      type: 'videoEmbed';
      attrs: { provider: 'youtube'; videoId: string } | { provider: 'vimeo'; videoId: string };
    };
export type PostBodyDocument = { type: 'doc'; content: PostBodyNode[] };

export const CODE_LANGUAGES = [
  'bash',
  'css',
  'html',
  'javascript',
  'json',
  'jsx',
  'plaintext',
  'python',
  'sql',
  'tsx',
  'typescript',
  'yaml',
] as const;
type CodeLanguage = (typeof CODE_LANGUAGES)[number];

const storable = <T extends z.ZodString>(schema: T) =>
  schema.refine(isStorableText, STORABLE_TEXT_MESSAGE);

const linkMark = (isSafe: (href: string) => boolean, message: string) =>
  z.strictObject({
    type: z.literal('link'),
    attrs: z.strictObject({
      href: storable(z.string().max(2048).refine(isSafe, message)),
      // TipTap 3.28's defaults are accepted only with their default values, then stripped on save.
      target: z.literal('_blank').nullable().optional(),
      rel: z.literal('noopener noreferrer nofollow').nullable().optional(),
      class: z.null().optional(),
      title: z.null().optional(),
    }),
  });

const onceEach = (marks: { type: string }[]) =>
  new Set(marks.map((mark) => mark.type)).size === marks.length;

const inlineFor = (mark: z.ZodType<PostBodyMark>, maxMarks: number) => {
  let marks = z.array(mark).max(maxMarks).refine(onceEach, 'Each mark may appear only once.');
  marks = marks.refine(
    (list) => !(list.some((m) => m.type === 'code') && list.some((m) => m.type === 'link')),
    'Inline code can’t also be a link.',
  );
  return z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('text'),
      text: storable(z.string().min(1).max(10_000)),
      marks: marks.optional(),
    }),
    z.strictObject({ type: z.literal('hardBreak'), marks: marks.optional() }),
  ]);
};

/** The version 1 and version 2 node unions; the recursion goes through `node()` so each version nests itself. */
function textNodes(inline: z.ZodType<PostBodyInline>, node: () => z.ZodType<PostBodyNode>) {
  const listItem = z.strictObject({
    type: z.literal('listItem'),
    get content(): z.ZodType<PostBodyNode[]> {
      return z
        .array(node())
        .min(1)
        .refine((nodes) => nodes[0]?.type === 'paragraph', 'A list item starts with a paragraph.');
    },
  });
  return [
    z.strictObject({ type: z.literal('paragraph'), content: z.array(inline).optional() }),
    z.strictObject({
      type: z.literal('heading'),
      attrs: z.strictObject({ level: z.union([z.literal(2), z.literal(3)]) }),
      content: z.array(inline).optional(),
    }),
    z.strictObject({ type: z.literal('bulletList'), content: z.array(listItem).min(1) }),
    z.strictObject({
      type: z.literal('orderedList'),
      attrs: z
        .strictObject({ start: z.number().int().min(1).max(100_000), type: z.null().optional() })
        .optional(),
      content: z.array(listItem).min(1),
    }),
    z.strictObject({
      type: z.literal('blockquote'),
      get content(): z.ZodType<PostBodyNode[]> {
        return z.array(node()).min(1);
      },
    }),
  ] as const;
}

// ---- Version 1 (unnamed: the gate for clients that declare it) ----

const markV1 = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('bold') }),
  z.strictObject({ type: z.literal('italic') }),
  linkMark(isSafeLinkHref, 'Links must be absolute https, http or mailto URLs.'),
]) as z.ZodType<PostBodyMark>;
const inlineV1 = inlineFor(markV1, 3) as z.ZodType<PostBodyInline>;
const nodeV1: z.ZodType<PostBodyNode> = z.discriminatedUnion(
  'type',
  textNodes(inlineV1, () => nodeV1) as never,
);
export const postBodyV1DocumentSchema = z.strictObject({
  type: z.literal('doc'),
  content: z.array(nodeV1),
});

// ---- Version 2 (the named components) ----

const markSchema = z
  .discriminatedUnion('type', [
    z.strictObject({ type: z.literal('bold') }),
    z.strictObject({ type: z.literal('italic') }),
    z.strictObject({ type: z.literal('underline') }),
    z.strictObject({ type: z.literal('strike') }),
    z.strictObject({ type: z.literal('code') }),
    linkMark(isSafeLinkHrefV2, 'Links must be https, http, mailto, /path or #anchor.'),
  ])
  .meta({ id: 'PostBodyMark' }) as z.ZodType<PostBodyMark>;
const inline = inlineFor(markSchema, 6) as z.ZodType<PostBodyInline>;

const dimension = z.number().int().min(1).max(6000);
const alt = storable(z.string().trim().min(1).max(300));
/** A media URL's shape only; the service checks its prefix and existence (spec §5.5). */
const mediaSource = storable(z.string().min(1).max(2048));

export const postBodyNodeSchema: z.ZodType<PostBodyNode> = z
  .discriminatedUnion('type', [
    ...(textNodes(inline, () => postBodyNodeSchema) as never as []),
    z.strictObject({
      type: z.literal('image'),
      attrs: z.strictObject({
        src: mediaSource,
        alt,
        title: storable(z.string().max(300)).nullable().optional(),
        width: dimension,
        height: dimension,
      }),
    }),
    z.strictObject({
      type: z.literal('beforeAfter'),
      attrs: z.strictObject({
        // '' = not uploaded yet: allowed in drafts, refused on publish (POST_MEDIA_INCOMPLETE).
        before: z.union([z.literal(''), mediaSource]),
        after: z.union([z.literal(''), mediaSource]),
        beforeAlt: alt,
        afterAlt: alt,
        caption: storable(z.string().max(300)),
        initial: z.number().int().min(0).max(100),
        width: dimension,
        height: dimension,
      }),
    }),
    z.strictObject({ type: z.literal('horizontalRule') }),
    z.strictObject({
      type: z.literal('codeBlock'),
      attrs: z.strictObject({ language: z.enum(CODE_LANGUAGES).nullable() }).optional(),
      content: z
        .array(
          z.strictObject({
            type: z.literal('text'),
            text: storable(z.string().min(1).max(10_000)),
          }),
        )
        .optional(),
    }),
    z.strictObject({
      type: z.literal('videoEmbed'),
      // Provider ids, never URLs or iframes: the web builds the embed (spec §5.5).
      attrs: z.discriminatedUnion('provider', [
        z.strictObject({
          provider: z.literal('youtube'),
          videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
        }),
        z.strictObject({
          provider: z.literal('vimeo'),
          videoId: z.string().regex(/^[0-9]{1,20}$/),
        }),
      ]),
    }),
  ])
  .meta({ id: 'PostBodyNode' }) as z.ZodType<PostBodyNode>;

export const postBodyDocumentSchema = z
  .strictObject({ type: z.literal('doc'), content: z.array(postBodyNodeSchema) })
  .meta({ id: 'PostBodyDocument' });

/**
 * The request field: the iterative limits pass first; when it adds an issue, Zod skips the recursive schema,
 * so a pathological document never reaches it (blog spec §4.3). Version 2 here; a version 1 request is
 * re-checked against `postBodyV1DocumentSchema` by `SavePostDto`.
 */
export const postBodyInputSchema = z.preprocess((value, ctx) => {
  for (const issue of checkPostBodyLimits(value)) {
    ctx.addIssue({ code: 'custom', message: issue.message, input: value });
  }
  return value;
}, postBodyDocumentSchema);
