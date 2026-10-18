import type { z } from 'zod';
import { toFieldErrors, type FieldCode, type SchemaIssue } from '../../../http/to-field-errors.js';
import {
  courseIdParamSchema,
  curriculumOrderSchema,
  saveCourseLessonSchema,
  saveCourseSchema,
  saveCourseSectionSchema,
} from './save-course.dto.js';

/** The `details.fields[]` a request would get, as `[field, code]` pairs. */
function fieldCodes(schema: z.ZodType, input: unknown): Array<[string, FieldCode]> {
  const result = schema.safeParse(input);
  if (result.success) return [];
  // The pipe hands the factory these same runtime issues (http-contract.module.ts).
  return toFieldErrors(result.error.issues as unknown as readonly SchemaIssue[]).map((error) => [
    error.field,
    error.code,
  ]);
}

const course = (overrides: Record<string, unknown> = {}) => ({
  slug: 'workflow-edit-video-youtube',
  title: 'Workflow edit video YouTube',
  summary: 'Quy trình dựng video từ A đến Z.',
  ...overrides,
});

const WHITESPACE_ONLY = [
  ['spaces', '   '],
  ['tab and newline', '\t\n'],
  ['no-break and ideographic spaces', ' 　'],
];

describe('saveCourseSchema', () => {
  it('trims surrounding whitespace from the title and summary', () => {
    expect(
      saveCourseSchema.parse(course({ title: '  Khóa học  ', summary: '\tTóm tắt\n' })),
    ).toEqual({
      slug: 'workflow-edit-video-youtube',
      title: 'Khóa học',
      summary: 'Tóm tắt',
    });
  });

  it.each(WHITESPACE_ONLY)('rejects a %s-only title and summary as TOO_SHORT', (_case, blank) => {
    expect(fieldCodes(saveCourseSchema, course({ title: blank, summary: blank }))).toEqual([
      ['title', 'TOO_SHORT'],
      ['summary', 'TOO_SHORT'],
    ]);
  });

  it.each([
    ['a NUL in the title', { title: '\u0000x' }, [['title', 'INVALID']]],
    ['a lone surrogate in the summary', { summary: 'a\ud800' }, [['summary', 'INVALID']]],
    ['a 201-character title', { title: 'a'.repeat(201) }, [['title', 'TOO_LONG']]],
    ['a 501-character summary', { summary: 'a'.repeat(501) }, [['summary', 'TOO_LONG']]],
    ['an uppercase slug', { slug: 'Khoa-Hoc' }, [['slug', 'INVALID_FORMAT']]],
    ['a 161-character slug', { slug: 'a'.repeat(161) }, [['slug', 'TOO_LONG']]],
    ['an unknown key', { status: 'published' }, [['status', 'UNKNOWN_FIELD']]],
  ])('rejects %s', (_case, overrides, expected) => {
    expect(fieldCodes(saveCourseSchema, course(overrides))).toEqual(expected);
  });

  it('accepts a 200-character title and a 500-character summary', () => {
    expect(
      fieldCodes(saveCourseSchema, course({ title: 'a'.repeat(200), summary: 'a'.repeat(500) })),
    ).toEqual([]);
  });
});

describe('saveCourseSectionSchema', () => {
  it.each(WHITESPACE_ONLY)('rejects a %s-only title as TOO_SHORT', (_case, blank) => {
    expect(fieldCodes(saveCourseSectionSchema, { title: blank })).toEqual([['title', 'TOO_SHORT']]);
  });

  it('rejects a NUL in the title', () => {
    expect(fieldCodes(saveCourseSectionSchema, { title: 'a\u0000' })).toEqual([
      ['title', 'INVALID'],
    ]);
  });
});

describe('saveCourseLessonSchema', () => {
  it('turns omitted optionals into null (full replacement)', () => {
    expect(saveCourseLessonSchema.parse({ title: ' Bài 1 ' })).toEqual({
      title: 'Bài 1',
      videoId: null,
      privacyHash: null,
      durationSeconds: null,
    });
  });

  it('keeps a full video reference', () => {
    expect(
      saveCourseLessonSchema.parse({
        title: 'Bài 1',
        videoId: '76979871',
        privacyHash: 'a1B2c3',
        durationSeconds: 86_400,
      }),
    ).toEqual({
      title: 'Bài 1',
      videoId: '76979871',
      privacyHash: 'a1B2c3',
      durationSeconds: 86_400,
    });
  });

  it.each(WHITESPACE_ONLY)('rejects a %s-only title as TOO_SHORT', (_case, blank) => {
    expect(fieldCodes(saveCourseLessonSchema, { title: blank })).toEqual([['title', 'TOO_SHORT']]);
  });

  it.each([
    ['a privacy hash without a video id', { privacyHash: 'abc' }, [['privacyHash', 'INVALID']]],
    ['a video id with a letter', { videoId: '12a' }, [['videoId', 'INVALID_FORMAT']]],
    ['a 21-digit video id', { videoId: '1'.repeat(21) }, [['videoId', 'INVALID_FORMAT']]],
    [
      'a privacy hash with a dash',
      { videoId: '1', privacyHash: 'ab-c' },
      [['privacyHash', 'INVALID_FORMAT']],
    ],
    ['a zero duration', { durationSeconds: 0 }, [['durationSeconds', 'TOO_SMALL']]],
    ['a negative duration', { durationSeconds: -1 }, [['durationSeconds', 'TOO_SMALL']]],
    ['a fractional duration', { durationSeconds: 1.5 }, [['durationSeconds', 'INVALID_TYPE']]],
    ['a duration over a day', { durationSeconds: 86_401 }, [['durationSeconds', 'TOO_LARGE']]],
    ['an unknown key', { videoUrl: 'https://vimeo.com/1' }, [['videoUrl', 'UNKNOWN_FIELD']]],
  ])('rejects %s', (_case, overrides, expected) => {
    expect(fieldCodes(saveCourseLessonSchema, { title: 'Bài 1', ...overrides })).toEqual(expected);
  });
});

describe('curriculumOrderSchema', () => {
  const id = '0190a8c4-0000-7000-8000-000000000001';

  it('accepts sections with lesson ids', () => {
    expect(fieldCodes(curriculumOrderSchema, { sections: [{ id, lessonIds: [id] }] })).toEqual([]);
  });

  it.each([
    [
      'a malformed section id',
      { sections: [{ id: 'x', lessonIds: [] }] },
      [['sections.0.id', 'INVALID_FORMAT']],
    ],
    [
      'a malformed lesson id',
      { sections: [{ id, lessonIds: ['x'] }] },
      [['sections.0.lessonIds.0', 'INVALID_FORMAT']],
    ],
    ['a missing lessonIds', { sections: [{ id }] }, [['sections.0.lessonIds', 'REQUIRED']]],
    ['an unknown key', { sections: [], extra: 1 }, [['extra', 'UNKNOWN_FIELD']]],
  ])('rejects %s', (_case, input, expected) => {
    expect(fieldCodes(curriculumOrderSchema, input)).toEqual(expected);
  });
});

describe('id params', () => {
  it('rejects a malformed course id as INVALID_FORMAT', () => {
    expect(fieldCodes(courseIdParamSchema, { courseId: 'x' })).toEqual([
      ['courseId', 'INVALID_FORMAT'],
    ]);
  });
});
