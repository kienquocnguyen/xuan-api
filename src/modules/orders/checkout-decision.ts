/** A pending order is reused only with at least this much of its VNPAY window left (S16). */
export const CHECKOUT_REUSE_MIN_REMAINING_MS = 60 * 1000;
/**
 * After `expires_at`, a new order still waits this long: expiry isn't proof that VNPAY never charged the buyer, since
 * a payment started just before it, or its IPN, can still arrive (S16).
 */
export const CHECKOUT_SETTLE_GRACE_MS = 5 * 60 * 1000;

export type CheckoutDecision =
  | Readonly<{ kind: 'create' }>
  | Readonly<{ kind: 'reuse' }>
  | Readonly<{ kind: 'wait'; retryAfterSeconds: number }>;

/**
 * What a checkout does, given the user's newest `pending` order for the course (S16): at most one payable order per
 * user and course, so two tabs or a double click can't lead to two charges.
 */
export function decideCheckout(
  live: Readonly<{ expiresAt: Date }> | null,
  now: number,
): CheckoutDecision {
  if (live === null) return { kind: 'create' };
  const expiresAt = live.expiresAt.getTime();
  if (expiresAt - now >= CHECKOUT_REUSE_MIN_REMAINING_MS) return { kind: 'reuse' };
  const waitMs = expiresAt + CHECKOUT_SETTLE_GRACE_MS - now;
  if (waitMs > 0) return { kind: 'wait', retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
  return { kind: 'create' };
}
