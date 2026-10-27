import { AppError } from '../../../errors/app-error.js';
import { nextCommentStatus, nextRatingStatus } from './moderation.js';

// Owner Q2: deleted is terminal for everyone; ratings are hidden and restored only.
describe('moderation transitions (blog completion spec §6.3)', () => {
  it.each([
    ['visible', 'hide', 'hidden'],
    ['visible', 'restore', 'visible'],
    ['visible', 'delete', 'deleted'],
    ['hidden', 'hide', 'hidden'],
    ['hidden', 'restore', 'visible'],
    ['hidden', 'delete', 'deleted'],
    ['deleted', 'delete', 'deleted'],
  ] as const)('comment %s + %s → %s', (current, action, next) => {
    expect(nextCommentStatus(current, action)).toBe(next);
  });

  it.each(['hide', 'restore'] as const)('refuses to %s a deleted comment', (action) => {
    let thrown: unknown;
    try {
      nextCommentStatus('deleted', action);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe('COMMENT_DELETED');
  });

  it.each([
    ['visible', 'hide', 'hidden'],
    ['visible', 'restore', 'visible'],
    ['hidden', 'hide', 'hidden'],
    ['hidden', 'restore', 'visible'],
  ] as const)('rating %s + %s → %s', (current, action, next) => {
    expect(nextRatingStatus(current, action)).toBe(next);
  });
});
