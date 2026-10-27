import { AppError } from '../../../errors/app-error.js';
import { contentErrors } from '../content.errors.js';
import type { CommentStatus } from './post-comment.entity.js';
import type { RatingStatus } from './post-rating.entity.js';

export const COMMENT_ACTIONS = ['hide', 'restore', 'delete'] as const;
export type CommentAction = (typeof COMMENT_ACTIONS)[number];
export const RATING_ACTIONS = ['hide', 'restore'] as const;
export type RatingAction = (typeof RATING_ACTIONS)[number];

/**
 * Owner Q2: hide and restore toggle a comment that isn't deleted; delete is final for everyone, so hide or
 * restore of a deleted comment → 409 COMMENT_DELETED. The same state back means "no change" to the caller.
 */
export function nextCommentStatus(current: CommentStatus, action: CommentAction): CommentStatus {
  if (action === 'delete') return 'deleted';
  if (current === 'deleted') throw new AppError(contentErrors.COMMENT_DELETED);
  return action === 'hide' ? 'hidden' : 'visible';
}

/** Ratings are hidden and restored only (Q2): a 1–5 value has no content to remove. */
export function nextRatingStatus(_current: RatingStatus, action: RatingAction): RatingStatus {
  return action === 'hide' ? 'hidden' : 'visible';
}
