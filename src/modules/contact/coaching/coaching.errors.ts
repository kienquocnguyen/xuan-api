import type { ErrorDefinition } from '../../../errors/app-error.js';

/** Coaching registration error codes (D10; coaching registrations design CR-6). */
export const coachingErrors = {
  COACHING_REGISTRATION_UNAVAILABLE: {
    code: 'COACHING_REGISTRATION_UNAVAILABLE',
    kind: 'unavailable',
    message: 'Registration is temporarily unavailable. Please try again later.',
  },
} as const satisfies Record<string, ErrorDefinition>;
