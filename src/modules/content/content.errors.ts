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
  CATEGORY_KEY_TAKEN: {
    code: 'CATEGORY_KEY_TAKEN',
    kind: 'conflict',
    message: 'Another category already uses this key.',
  },
  CATEGORY_SLUG_TAKEN: {
    code: 'CATEGORY_SLUG_TAKEN',
    kind: 'conflict',
    message: 'Another category already uses this slug.',
  },
  CATEGORY_IN_USE: {
    code: 'CATEGORY_IN_USE',
    kind: 'conflict',
    message: 'Posts still use this category; archive it instead.',
  },
  CATEGORY_NOT_FOUND: {
    code: 'CATEGORY_NOT_FOUND',
    kind: 'conflict',
    message: "The chosen category doesn't exist.",
  },
  CATEGORY_ARCHIVED: {
    code: 'CATEGORY_ARCHIVED',
    kind: 'conflict',
    message: 'The chosen category is archived.',
  },
  POST_CATEGORY_REQUIRED: {
    code: 'POST_CATEGORY_REQUIRED',
    kind: 'conflict',
    message: 'A published post needs a category.',
  },
  MEDIA_STORAGE_DISABLED: {
    code: 'MEDIA_STORAGE_DISABLED',
    kind: 'conflict',
    message: 'Image uploads are switched off on this server.',
  },
  POST_MEDIA_NOT_FOUND: {
    code: 'POST_MEDIA_NOT_FOUND',
    kind: 'conflict',
    message: "The chosen image doesn't exist.",
  },
  POST_MEDIA_INCOMPLETE: {
    code: 'POST_MEDIA_INCOMPLETE',
    kind: 'conflict',
    message: 'Finish the before/after images first.',
  },
  POST_BODY_VERSION_UNSUPPORTED: {
    code: 'POST_BODY_VERSION_UNSUPPORTED',
    kind: 'conflict',
    message: 'This post needs an editor that supports body version 2.',
  },
} as const satisfies Record<string, ErrorDefinition>;
