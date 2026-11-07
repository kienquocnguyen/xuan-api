import type { ErrorDefinition } from '../../errors/app-error.js';

/** Orders-module error codes (D10; course sales spec §5.4). */
export const ordersErrors = {
  COURSE_NOT_FOR_SALE: {
    code: 'COURSE_NOT_FOR_SALE',
    kind: 'conflict',
    message: "This course isn't open for purchase.",
  },
  COURSE_ALREADY_OWNED: {
    code: 'COURSE_ALREADY_OWNED',
    kind: 'conflict',
    message: 'You already have access to this course.',
  },
  PAYMENTS_UNAVAILABLE: {
    code: 'PAYMENTS_UNAVAILABLE',
    kind: 'unavailable',
    message: 'Online payment is temporarily unavailable.',
  },
} as const satisfies Record<string, ErrorDefinition>;
