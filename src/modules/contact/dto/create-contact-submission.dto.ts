import { z } from 'zod';
import { CONTACT_SUBJECTS } from '../contact-subjects.js';
import { FORM_NAME_MAX, formEmail, formName, formText } from './form-text.js';

export const CONTACT_NAME_MAX = FORM_NAME_MAX;
export const CONTACT_MESSAGE_MIN = 10;
export const CONTACT_MESSAGE_MAX = 5000;

/** The public contact form (contact form design §4). The token is checked with Google, never stored. */
export const createContactSubmissionSchema = z
  .strictObject({
    name: formName,
    email: formEmail,
    subject: z.enum(CONTACT_SUBJECTS),
    message: formText(CONTACT_MESSAGE_MIN, CONTACT_MESSAGE_MAX, 'Write a message.'),
    recaptchaToken: z.string().min(1).max(4096),
  })
  .meta({ id: 'CreateContactSubmissionDto' });
export type CreateContactSubmissionInput = z.infer<typeof createContactSubmissionSchema>;
