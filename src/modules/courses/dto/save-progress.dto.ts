import { z } from 'zod';

/**
 * A progress save (course spec §9.2, contract identifier I19). The user is always the session user (I9), so
 * there's no user field; `completed` is only ever `true`, since completion is sticky (§9.3).
 */
export const saveLessonProgressSchema = z
  .strictObject({
    positionSeconds: z.int().min(0).max(86_400),
    completed: z.literal(true).optional(),
  })
  .meta({ id: 'SaveLessonProgressDto' });

export type SaveLessonProgressInput = z.infer<typeof saveLessonProgressSchema>;
