/**
 * A `pending` attempt older than this was interrupted (the request died, or the outcome couldn't be written), so an
 * admin may retry it. An attempt lasts at most the 8 s provider timeout plus two short writes, so a live attempt is
 * never retried (CF-12). Shared by the contact and coaching notifications.
 */
export const STALE_ATTEMPT_SECONDS = 600;
