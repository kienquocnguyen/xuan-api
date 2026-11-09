import { z } from 'zod';
import { isStorableText, STORABLE_TEXT_MESSAGE } from '../../../http/validation/storable-text.js';

export const FORM_NAME_MAX = 100;

// JS trim() keeps U+0085 and U+001C–U+001F, which the database's `[^[:space:]]` CHECK may count as space.
// oxlint-disable-next-line no-control-regex
const VISIBLE = /[^\s\u0085\u001c-\u001f]/u;
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

/**
 * Length in code points, as PostgreSQL's `varchar(n)` counts, so an emoji is one character. Reported as Zod's own
 * `too_small` / `too_big`, so the field codes are TOO_SHORT / TOO_LONG (api-contract.md §4).
 */
export const codePointLength =
  (min: number, max: number) => (value: string, ctx: z.RefinementCtx) => {
    const length = Array.from(value).length;
    if (length < min)
      ctx.addIssue({
        code: 'too_small',
        origin: 'string',
        minimum: min,
        inclusive: true,
        input: value,
        message: `At least ${min} characters.`,
      });
    if (length > max)
      ctx.addIssue({
        code: 'too_big',
        origin: 'string',
        maximum: max,
        inclusive: true,
        input: value,
        message: `At most ${max} characters.`,
      });
  };

export const formName = z
  .string()
  .trim()
  .superRefine(codePointLength(1, FORM_NAME_MAX))
  .refine((value) => value === '' || VISIBLE.test(value), { message: 'Write a name.' })
  .refine((value) => !CONTROL.test(value), { message: 'A name is one line of text.' })
  .refine(isStorableText, STORABLE_TEXT_MESSAGE);

export const formEmail = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** Plain text: line endings become `\n`, the ends are trimmed. `min` 0 accepts a blank string. */
export const formText = (min: number, max: number, invisibleMessage = 'Write some text.') =>
  z
    .string()
    .overwrite((value) => value.replace(/\r\n?/g, '\n').trim())
    .superRefine(codePointLength(min, max))
    .refine((value) => value === '' || VISIBLE.test(value), { message: invisibleMessage })
    .refine(isStorableText, STORABLE_TEXT_MESSAGE);
