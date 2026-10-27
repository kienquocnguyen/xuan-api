import type { ErrorDefinition } from './app-error.js';

export const baselineErrors = {
  VALIDATION_FAILED: {
    code: 'VALIDATION_FAILED',
    kind: 'validation',
    message: 'The request is invalid.',
  },
  UNAUTHENTICATED: {
    code: 'UNAUTHENTICATED',
    kind: 'unauthenticated',
    message: 'You need to sign in.',
  },
  FORBIDDEN: {
    code: 'FORBIDDEN',
    kind: 'forbidden',
    message: 'You are not allowed to do this.',
  },
  NOT_FOUND: {
    code: 'NOT_FOUND',
    kind: 'not_found',
    message: 'The requested resource was not found.',
  },
  /** First used by discussion writes (blog completion B4, BD-8); the response carries `Retry-After`. */
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    kind: 'rate_limited',
    message: 'Too many requests. Try again in a moment.',
  },
} as const satisfies Record<string, ErrorDefinition>;
