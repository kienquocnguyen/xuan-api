import type { ErrorDefinition } from '../../errors/app-error.js';

/** Content-module error codes (D10; blog spec §5.3, blog completion spec §3). */
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
  POST_ARCHIVED: {
    code: 'POST_ARCHIVED',
    kind: 'conflict',
    message: 'An archived post must be restored first.',
  },
  POST_WAS_PUBLISHED: {
    code: 'POST_WAS_PUBLISHED',
    kind: 'conflict',
    message: "A post that was ever published can't be deleted; archive it instead.",
  },
  POST_FIELDS_OMITTED: {
    code: 'POST_FIELDS_OMITTED',
    kind: 'conflict',
    message: 'Send every field: the request leaves out fields that hold data.',
  },
} as const satisfies Record<string, ErrorDefinition>;
