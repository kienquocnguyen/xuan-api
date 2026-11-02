/** Automatic attempts before a notification is `failed`; an admin can still retry it (CF-12, CF-13). */
export const MAX_AUTOMATIC_ATTEMPTS = 5;

/** A claimed attempt pushes `notification_next_attempt_at` this far ahead: a crashed attempt is retried after it. */
export const ATTEMPT_LEASE_SECONDS = 120;

const RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200];

/** The wait after the `attempts`-th failed attempt, or `null` when no automatic attempt is left. */
export function retryDelaySeconds(attempts: number): number | null {
  return attempts < MAX_AUTOMATIC_ATTEMPTS ? RETRY_DELAYS_SECONDS[attempts - 1] : null;
}
