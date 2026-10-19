import type { z } from 'zod';
import { toFieldErrors, type FieldCode, type SchemaIssue } from '../../../http/to-field-errors.js';
import { saveLessonProgressSchema } from './save-progress.dto.js';

/** The `details.fields[]` a request would get, as `[field, code]` pairs. */
function fieldCodes(schema: z.ZodType, input: unknown): Array<[string, FieldCode]> {
  const result = schema.safeParse(input);
  if (result.success) return [];
  return toFieldErrors(result.error.issues as unknown as readonly SchemaIssue[]).map((error) => [
    error.field,
    error.code,
  ]);
}

describe('saveLessonProgressSchema', () => {
  it.each([
    ['a zero position', { positionSeconds: 0 }],
    ['a full-day position with completion', { positionSeconds: 86_400, completed: true }],
  ])('accepts %s', (_case, input) => {
    expect(fieldCodes(saveLessonProgressSchema, input)).toEqual([]);
  });

  it('keeps an omitted completion omitted (completion is never cleared)', () => {
    expect(saveLessonProgressSchema.parse({ positionSeconds: 5 })).toEqual({ positionSeconds: 5 });
  });

  it.each([
    ['completed: false', { positionSeconds: 5, completed: false }, [['completed', 'INVALID']]],
    ['a negative position', { positionSeconds: -1 }, [['positionSeconds', 'TOO_SMALL']]],
    ['a position over a day', { positionSeconds: 86_401 }, [['positionSeconds', 'TOO_LARGE']]],
    ['a fractional position', { positionSeconds: 1.5 }, [['positionSeconds', 'INVALID_TYPE']]],
    ['a missing position', {}, [['positionSeconds', 'REQUIRED']]],
    ['a position as a string', { positionSeconds: '5' }, [['positionSeconds', 'INVALID_TYPE']]],
    ['a client user id', { positionSeconds: 5, userId: 'x' }, [['userId', 'UNKNOWN_FIELD']]],
  ])('rejects %s', (_case, input, expected) => {
    expect(fieldCodes(saveLessonProgressSchema, input)).toEqual(expected);
  });
});
