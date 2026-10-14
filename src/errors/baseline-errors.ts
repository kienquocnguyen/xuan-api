import type { ErrorDefinition } from './app-error.js';

export const baselineErrors = {
  VALIDATION_FAILED: {
    code: 'VALIDATION_FAILED',
    kind: 'validation',
    message: 'The request is invalid.',
  },
  NOT_FOUND: {
    code: 'NOT_FOUND',
    kind: 'not_found',
    message: 'The requested resource was not found.',
  },
} as const satisfies Record<string, ErrorDefinition>;
