import {
  CHECKOUT_REUSE_MIN_REMAINING_MS,
  CHECKOUT_SETTLE_GRACE_MS,
  decideCheckout,
} from './checkout-decision.js';

const NOW = Date.parse('2026-11-08T10:00:00.000Z');
const at = (offsetMs: number) => ({ expiresAt: new Date(NOW + offsetMs) });
const MINUTE = 60_000;

/** S16: at most one payable order per user and course; reuse it, or wait for its outcome, before a new one. */
describe('decideCheckout (course sales spec S16)', () => {
  it('creates an order when nothing is pending', () => {
    expect(decideCheckout(null, NOW)).toEqual({ kind: 'create' });
  });

  it.each([
    ['a full payment window left', at(15 * MINUTE)],
    ['exactly the minimum left', at(CHECKOUT_REUSE_MIN_REMAINING_MS)],
  ])('reuses the pending order with %s', (_case, live) => {
    expect(decideCheckout(live, NOW)).toEqual({ kind: 'reuse' });
  });

  it.each([
    // Too little time to pay: VNPAY would expire the page mid-payment.
    ['in its last minute', at(CHECKOUT_REUSE_MIN_REMAINING_MS - 1), 6 * 60],
    ['just expired', at(0), 5 * 60],
    // Expiry isn't proof VNPAY didn't charge: a payment started before it can still settle.
    ['expired, inside the grace', at(-4 * MINUTE), 60],
    ['1 ms before the grace ends', at(1 - CHECKOUT_SETTLE_GRACE_MS), 1],
  ])('waits for an order %s, until expiry + grace (Retry-After)', (_case, live, seconds) => {
    expect(decideCheckout(live, NOW)).toEqual({ kind: 'wait', retryAfterSeconds: seconds });
  });

  it.each([
    ['at the end of the grace', at(-CHECKOUT_SETTLE_GRACE_MS)],
    ['long expired', at(-60 * MINUTE)],
  ])('creates a new order once the old one is past expiry + grace: %s', (_case, live) => {
    expect(decideCheckout(live, NOW)).toEqual({ kind: 'create' });
  });

  it('uses 1 minute and 5 minutes', () => {
    expect(CHECKOUT_REUSE_MIN_REMAINING_MS).toBe(MINUTE);
    expect(CHECKOUT_SETTLE_GRACE_MS).toBe(5 * MINUTE);
  });
});
