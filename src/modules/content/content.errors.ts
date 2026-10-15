import type { ErrorDefinition } from '../../errors/app-error.js';

/** Content-module error codes (D10; blog spec §5.3). */
export const contentErrors = {
  POST_SLUG_TAKEN: {
    code: 'POST_SLUG_TAKEN',
    kind: 'conflict',
    message: 'Another post already uses this slug.',
  },
  POST_SLUG_LOCKED: {
    code: 'POST_SLUG_LOCKED',
    kind: 'conflict',
    message: 'A published post keeps its slug.',
  },
  POST_BODY_EMPTY: {
    code: 'POST_BODY_EMPTY',
    kind: 'conflict',
    message: 'A published post needs some content.',
  },
} as const satisfies Record<string, ErrorDefinition>;
