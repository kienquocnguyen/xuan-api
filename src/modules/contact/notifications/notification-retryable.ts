import type { NotificationStatus } from '../contact-submission.entity.js';
import { STALE_ATTEMPT_SECONDS } from './stale-attempt.js';

/**
 * Whether an admin retry would attempt now (CF-13): `failed`, or `pending` with a stale attempt. Same rule as the
 * retry claims, on the app's clock rather than the database's: near the boundary a retry may claim nothing, and its
 * answer shows the state as it is. Shared by the contact and coaching inboxes.
 */
export function isNotificationRetryable(
  state: Readonly<{ notificationStatus: NotificationStatus; notificationAttemptedAt: Date | null }>,
  now: Date,
): boolean {
  if (state.notificationStatus === 'failed') return true;
  return (
    state.notificationStatus === 'pending' &&
    state.notificationAttemptedAt !== null &&
    now.getTime() - state.notificationAttemptedAt.getTime() > STALE_ATTEMPT_SECONDS * 1000
  );
}
