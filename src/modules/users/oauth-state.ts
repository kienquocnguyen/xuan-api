import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const OAUTH_STATE_COOKIE = 'xc_oauth';
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Where to land in the web app after sign-in: a relative path only (auth design §4). No `//` or `/\`
 * (protocol-relative tricks), no whitespace or control characters, at most 512 characters.
 */
export const returnToSchema = z
  .string()
  .max(512)
  // oxlint-disable-next-line no-control-regex -- rejecting control characters is the point
  .regex(/^\/(?![/\\])[^\s\\\u0000-\u001f\u007f]*$/);

const oauthStateSchema = z.strictObject({
  state: z.string().min(1),
  nonce: z.string().min(1),
  verifier: z.string().min(43),
  returnTo: returnToSchema,
  exp: z.number().int(),
});

/** Payload of the signed, single-use `xc_oauth` cookie. */
export type OAuthState = z.infer<typeof oauthStateSchema>;

const random = () => randomBytes(32).toString('base64url');

export function createOAuthState(returnTo: string, now = Date.now()): OAuthState {
  return {
    state: random(),
    nonce: random(),
    verifier: random(),
    returnTo,
    exp: now + OAUTH_STATE_TTL_MS,
  };
}

/** `raw` is cookie-parser's signed value: a string when the signature holds, `false` when tampered. */
export function parseOAuthState(raw: unknown, now = Date.now()): OAuthState | null {
  if (typeof raw !== 'string') return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = oauthStateSchema.safeParse(json);
  if (!parsed.success || parsed.data.exp <= now) return null;
  return parsed.data;
}

/** PKCE S256 code challenge. */
export function codeChallengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function sameState(expected: string, received: string | undefined): boolean {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Absolute URL in the web app. Throws if the result would leave `webOrigin` (defense in depth). */
export function webRedirectUrl(webOrigin: string, path: string): string {
  const url = new URL(path, webOrigin);
  if (url.origin !== webOrigin) throw new Error('Redirect would leave the web origin.');
  return url.toString();
}
