import { z } from 'zod';
import { postBodyInputSchema, postBodyV1DocumentSchema } from '../body/post-body.schema.js';
import { isStorableText, STORABLE_TEXT_MESSAGE } from '../../../http/validation/storable-text.js';

/** Same rule as ck_content_posts_slug_format (database.md §12). */
export const POST_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Optional text: trimmed; blank or omitted becomes `null` (full replacement on PUT). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(isStorableText, STORABLE_TEXT_MESSAGE)
    .optional()
    .transform((value) => (value ? value : null));

/** One tag (blog completion spec §3.2): trimmed, 1–40 characters, storable, no comma (the web's tag input splits on it). */
const tag = z
  .string()
  .trim()
  // One stored form whatever the keyboard sends (decomposed Vietnamese is NFD); limits count the NFC form.
  .transform((value) => value.normalize('NFC'))
  .pipe(
    z
      .string()
      .min(1)
      .max(40)
      .refine(isStorableText, STORABLE_TEXT_MESSAGE)
      .refine((value) => !value.includes(','), 'A tag can’t contain a comma.'),
  );

/** Case- and Unicode-form-insensitive identity of a tag ('Đà Lạt' = 'đà lạt'; NFC = NFD). */
const tagKey = (value: string) => value.normalize('NFC').toLowerCase();

/**
 * 0–10 tags in the author's order. Duplicates are rejected at the later position, never dropped. `null` clears;
 * an omitted key stays absent so the update can tell it apart (spec §3.4, the omitted-field guard).
 */
const tags = z
  .array(tag)
  .max(10)
  .superRefine((values, ctx) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      const key = tagKey(value);
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [index], message: 'Duplicate tag.' });
      seen.add(key);
    });
  })
  .nullable()
  .optional();

/**
 * Create and full-replacement update (blog spec §5.3). Author, status, dates and language are never
 * client input (I9).
 */
export const savePostSchema = z
  .strictObject({
    slug: z.string().max(160).regex(POST_SLUG_PATTERN),
    title: z.string().trim().min(1).max(200).refine(isStorableText, STORABLE_TEXT_MESSAGE),
    body: postBodyInputSchema,
    excerpt: optionalText(400),
    seoTitle: optionalText(200),
    seoDescription: optionalText(400),
    tags,
    /** One category (blog completion B2): `null` clears it; an omission is guarded (spec §3.4). */
    categoryId: z.uuid().nullable().optional(),
    /**
     * The body format the client's editor speaks (blog completion spec §3.4); omitted = 1. It gates what the
     * body may contain; the stored version is still the lowest the document fits.
     */
    bodyVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  })
  .superRefine((input, ctx) => {
    if ((input.bodyVersion ?? 1) !== 1) return;
    // A version 1 client sends only version 1 nodes; anything newer is reported at its own path.
    for (const issue of postBodyV1DocumentSchema.safeParse(input.body).error?.issues ?? []) {
      ctx.addIssue({ ...issue, code: 'custom', path: ['body', ...issue.path] } as never);
    }
  })
  .meta({ id: 'SavePostDto' });

export type SavePostInput = z.infer<typeof savePostSchema>;
