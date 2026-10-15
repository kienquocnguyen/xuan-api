import { z } from 'zod';
import { postBodyInputSchema } from '../body/post-body.schema.js';

/** Same rule as ck_content_posts_slug_format (database.md §12). */
export const POST_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const NUL_FREE = (value: string) => !value.includes('\u0000');
const NUL_MESSAGE = 'Text must not contain NUL characters.';

/** Optional text: trimmed; blank or omitted becomes `null` (full replacement on PUT). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(NUL_FREE, NUL_MESSAGE)
    .optional()
    .transform((value) => (value ? value : null));

/**
 * Create and full-replacement update (blog spec §5.3). Author, status, dates and language are never
 * client input (I9).
 */
export const savePostSchema = z
  .strictObject({
    slug: z.string().max(160).regex(POST_SLUG_PATTERN),
    title: z.string().trim().min(1).max(200).refine(NUL_FREE, NUL_MESSAGE),
    body: postBodyInputSchema,
    excerpt: optionalText(400),
    seoTitle: optionalText(200),
    seoDescription: optionalText(400),
  })
  .meta({ id: 'SavePostDto' });

export type SavePostInput = z.infer<typeof savePostSchema>;
