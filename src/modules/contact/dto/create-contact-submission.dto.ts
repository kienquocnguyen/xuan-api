import { z } from 'zod';
import { isStorableText, STORABLE_TEXT_MESSAGE } from '../../../http/validation/storable-text.js';
import { CONTACT_SUBJECTS } from '../contact-subjects.js';

export const CONTACT_NAME_MAX = 100;
export const CONTACT_MESSAGE_MIN = 10;
export const CONTACT_MESSAGE_MAX = 5000;

// JS trim() keeps U+0085 and U+001C–U+001F, which the database's `[^[:space:]]` CHECK may count as space.
// oxlint-disable-next-line no-control-regex
const VISIBLE = /[^\s\u0085\u001c-\u001f]/u;
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

/**
 * Length in code points, as PostgreSQL's `varchar(n)` counts, so an emoji is one character. Reported as Zod's own
 * `too_small` / `too_big`, so the field codes are TOO_SHORT / TOO_LONG (api-contract.md §4).
 */
const codePointLength = (min: number, max: number) => (value: string, ctx: z.RefinementCtx) => {
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

const name = z
  .string()
  .trim()
  .superRefine(codePointLength(1, CONTACT_NAME_MAX))
  .refine((value) => value === '' || VISIBLE.test(value), { message: 'Write a name.' })
  .refine((value) => !CONTROL.test(value), { message: 'A name is one line of text.' })
  .refine(isStorableText, STORABLE_TEXT_MESSAGE);

/** Plain text: line endings become `\n`, the ends are trimmed. */
const message = z
  .string()
  .overwrite((value) => value.replace(/\r\n?/g, '\n').trim())
  .superRefine(codePointLength(CONTACT_MESSAGE_MIN, CONTACT_MESSAGE_MAX))
  .refine((value) => value === '' || VISIBLE.test(value), { message: 'Write a message.' })
  .refine(isStorableText, STORABLE_TEXT_MESSAGE);

/** The public contact form (contact form design §4). The token is checked with Google, never stored. */
export const createContactSubmissionSchema = z
  .strictObject({
    name,
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    subject: z.enum(CONTACT_SUBJECTS),
    message,
    recaptchaToken: z.string().min(1).max(4096),
  })
  .meta({ id: 'CreateContactSubmissionDto' });
export type CreateContactSubmissionInput = z.infer<typeof createContactSubmissionSchema>;
