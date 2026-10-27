import { z } from 'zod';
import { pageQueryFields } from '../../../http/pagination/page.js';
import { isStorableText, STORABLE_TEXT_MESSAGE } from '../../../http/validation/storable-text.js';

/** A 1–5 star rating (blog completion spec §6.2). */
export const savePostRatingSchema = z
  .strictObject({ value: z.number().int().min(1).max(5) })
  .meta({ id: 'SavePostRatingDto' });
export type SavePostRatingInput = z.infer<typeof savePostRatingSchema>;

export const COMMENT_MAX_CODE_POINTS = 2000;

/**
 * Plain text (spec §6.2): line endings become `\n`, the ends are trimmed, and the length counts code points, so an
 * emoji is one character (as PostgreSQL's `varchar(2000)` counts).
 */
const commentBody = z
  .string()
  .overwrite((value) => value.replace(/\r\n?/g, '\n').trim())
  .min(1)
  .refine((value) => Array.from(value).length <= COMMENT_MAX_CODE_POINTS, {
    message: `At most ${COMMENT_MAX_CODE_POINTS} characters.`,
  })
  .refine(isStorableText, STORABLE_TEXT_MESSAGE);

export const savePostCommentSchema = z
  .strictObject({ body: commentBody })
  .meta({ id: 'SavePostCommentDto' });
export type SavePostCommentInput = z.infer<typeof savePostCommentSchema>;

/** Readers page through a post's visible comments, 10 at a time by default (spec §6.2). */
export const postCommentsQuerySchema = z
  .strictObject({
    page: pageQueryFields.page,
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
  })
  .meta({ id: 'PostCommentsQuery' });
export type PostCommentsQuery = z.infer<typeof postCommentsQuerySchema>;

export const postCommentIdParamSchema = z
  .strictObject({ commentId: z.uuid() })
  .meta({ id: 'PostCommentIdParam' });
export type PostCommentIdParam = z.infer<typeof postCommentIdParamSchema>;
