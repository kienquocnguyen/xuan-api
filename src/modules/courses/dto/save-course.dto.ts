import { z } from 'zod';
import { isStorableText, STORABLE_TEXT_MESSAGE } from '../../../http/validation/storable-text.js';

/** Same rule as ck_courses_slug_format (database.md §12). */
export const COURSE_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Same rules as ck_course_lessons_vimeo_video_id_format and ck_course_lessons_vimeo_hash_format. */
const VIMEO_VIDEO_ID_PATTERN = /^[0-9]{1,20}$/;
const VIMEO_HASH_PATTERN = /^[A-Za-z0-9]{1,64}$/;

/** Required text: trimmed, so whitespace-only input is `TOO_SHORT`; limits match the `varchar` sizes. */
const requiredText = (max: number) =>
  z.string().trim().min(1).max(max).refine(isStorableText, STORABLE_TEXT_MESSAGE);

/** Omitted becomes `null`: a `PUT` is a full replacement (course spec §11.3). */
const optional = <T extends z.ZodType>(schema: T) =>
  schema.optional().transform((value) => value ?? null);

/** Create and full-replacement update of a course. Status and dates are never client input (I9). */
export const saveCourseSchema = z
  .strictObject({
    slug: z.string().max(160).regex(COURSE_SLUG_PATTERN),
    title: requiredText(200),
    summary: requiredText(500),
  })
  .meta({ id: 'SaveCourseDto' });

export const saveCourseSectionSchema = z
  .strictObject({ title: requiredText(200) })
  .meta({ id: 'SaveCourseSectionDto' });

/** A lesson's title and Vimeo reference. Status changes only through publish/unpublish (I9). */
export const saveCourseLessonSchema = z
  .strictObject({
    title: requiredText(200),
    videoId: optional(z.string().regex(VIMEO_VIDEO_ID_PATTERN)),
    privacyHash: optional(z.string().regex(VIMEO_HASH_PATTERN)),
    durationSeconds: optional(z.int().min(1).max(86_400)),
  })
  .superRefine((lesson, ctx) => {
    // Same rule as ck_course_lessons_hash_needs_video.
    if (lesson.privacyHash !== null && lesson.videoId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['privacyHash'],
        message: 'A privacy hash needs a video id.',
      });
    }
  })
  .meta({ id: 'SaveCourseLessonDto' });

/** Every section of the course, each with every lesson it should hold, in the new order (course spec §10.3). */
export const curriculumOrderSchema = z
  .strictObject({
    sections: z
      .array(z.strictObject({ id: z.uuid(), lessonIds: z.array(z.uuid()).max(500) }))
      .max(200),
  })
  .meta({ id: 'CurriculumOrderDto' });

export const courseIdParamSchema = z
  .strictObject({ courseId: z.uuid() })
  .meta({ id: 'CourseIdParam' });
export const courseSectionIdParamSchema = z
  .strictObject({ sectionId: z.uuid() })
  .meta({ id: 'CourseSectionIdParam' });
export const courseLessonIdParamSchema = z
  .strictObject({ lessonId: z.uuid() })
  .meta({ id: 'CourseLessonIdParam' });

export type SaveCourseInput = z.infer<typeof saveCourseSchema>;
export type SaveCourseSectionInput = z.infer<typeof saveCourseSectionSchema>;
export type SaveCourseLessonInput = z.infer<typeof saveCourseLessonSchema>;
export type CurriculumOrderInput = z.infer<typeof curriculumOrderSchema>;
