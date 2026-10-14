import type { ErrorKind } from '../errors/app-error.js';

export const statusForKind: Record<ErrorKind, number> = {
  validation: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
};

/** Codes the HTTP layer produces itself (not business definitions). */
export const frameworkCodes = {
  PAYLOAD_TOO_LARGE: {
    code: 'PAYLOAD_TOO_LARGE',
    status: 413,
    message: 'The request body is too large.',
  },
  INTERNAL_ERROR: {
    code: 'INTERNAL_ERROR',
    status: 500,
    message: 'Something went wrong. Please try again.',
  },
} as const;
