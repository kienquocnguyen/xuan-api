import { z } from 'zod';
import { pageQueryFields } from '../../../http/pagination/page.js';
import { POST_STATUSES } from '../post.entity.js';

export const postsPageQuerySchema = z
  .strictObject({
    /** An active category's slug (blog completion spec §4.3); unknown or archived → 404. */
    category: z
      .string()
      .max(80)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      .optional(),
    ...pageQueryFields,
  })
  .meta({ id: 'PostsPageQuery' });

export const adminPostsQuerySchema = z
  .strictObject({ status: z.enum(POST_STATUSES).optional(), ...pageQueryFields })
  .meta({ id: 'AdminPostsQuery' });

export const postIdParamSchema = z.strictObject({ id: z.uuid() }).meta({ id: 'PostIdParam' });
