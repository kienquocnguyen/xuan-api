import { createHmac, timingSafeEqual } from 'node:crypto';

/** The fields VNPAY appends that are never part of the signed data (techspec §2.5.8). */
const HASH_FIELDS = new Set(['vnp_SecureHash', 'vnp_SecureHashType']);
const HMAC_SHA512_HEX = /^[0-9a-fA-F]{128}$/;

/** PHP's `urlencode`: like `encodeURIComponent`, plus `!'()*~` percent-encoded and a space as `+`. */
function urlencode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*~]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');
}

/**
 * The signed data (course sales spec S8): keys sorted, empty values skipped, `urlencode(k)=urlencode(v)` joined
 * by `&`, as VNPAY's current official demos build it. The same string is the payment URL's query.
 */
export function canonicalQuery(params: Readonly<Record<string, string>>): string {
  return Object.keys(params)
    .filter((key) => params[key] !== '')
    .sort()
    .map((key) => `${urlencode(key)}=${urlencode(params[key])}`)
    .join('&');
}

/** Lowercase hex HMAC-SHA512 of the canonical query (techspec v2.1.0). */
export function signVnpay(secret: string, params: Readonly<Record<string, string>>): string {
  return createHmac('sha512', secret).update(canonicalQuery(params), 'utf8').digest('hex');
}

export type VnpayVerification =
  Readonly<{ valid: true; params: Readonly<Record<string, string>> }> | Readonly<{ valid: false }>;

/**
 * Verifies VNPAY's signature over a parsed query string. Only `vnp_*` keys are signed; any of them that isn't a
 * single string (a repeated key arrives as an array) makes the whole query invalid, never a guess. The compare is
 * constant-time over equal-length buffers.
 */
export function verifyVnpay(
  secret: string,
  query: Readonly<Record<string, unknown>>,
): VnpayVerification {
  const received = query.vnp_SecureHash;
  if (typeof received !== 'string' || !HMAC_SHA512_HEX.test(received)) return { valid: false };
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith('vnp_') || HASH_FIELDS.has(key) || value === undefined) continue;
    if (typeof value !== 'string') return { valid: false };
    params[key] = value;
  }
  const expected = Buffer.from(signVnpay(secret, params), 'hex');
  const actual = Buffer.from(received, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected)
    ? { valid: true, params }
    : { valid: false };
}
