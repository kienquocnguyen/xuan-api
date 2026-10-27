import { z } from 'zod';

/** A 1–5 star rating (blog completion spec §6.2). */
export const savePostRatingSchema = z
  .strictObject({ value: z.number().int().min(1).max(5) })
  .meta({ id: 'SavePostRatingDto' });
export type SavePostRatingInput = z.infer<typeof savePostRatingSchema>;
