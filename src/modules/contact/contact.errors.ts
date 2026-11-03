import type { ErrorDefinition } from '../../errors/app-error.js';

/** Contact-module error codes (D10; contact form design CF-4, CF-5, CF-13). */
export const contactErrors = {
  RECAPTCHA_VERIFICATION_FAILED: {
    code: 'RECAPTCHA_VERIFICATION_FAILED',
    kind: 'forbidden',
    message: "We couldn't verify this request. Please try again.",
  },
  CONTACT_FORM_UNAVAILABLE: {
    code: 'CONTACT_FORM_UNAVAILABLE',
    kind: 'unavailable',
    message: 'The contact form is temporarily unavailable. Please try again later.',
  },
  CONTACT_NOTIFICATIONS_UNAVAILABLE: {
    code: 'CONTACT_NOTIFICATIONS_UNAVAILABLE',
    kind: 'unavailable',
    message: 'Notification email is not configured.',
  },
} as const satisfies Record<string, ErrorDefinition>;
