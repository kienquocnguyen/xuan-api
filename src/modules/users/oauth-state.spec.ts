import { createHash } from 'node:crypto';
import {
  codeChallengeFor,
  createOAuthState,
  OAUTH_STATE_TTL_MS,
  parseOAuthState,
  returnToSchema,
  sameState,
  webRedirectUrl,
} from './oauth-state.js';

describe('returnToSchema', () => {
  it.each(['/', '/services/channel-kickstart', '/dashboard?tab=posts#top', '/a/b-c_d.e~f'])(
    'accepts the relative path %s',
    (path) => {
      expect(returnToSchema.safeParse(path).success).toBe(true);
    },
  );

  it.each([
    ['protocol-relative', '//evil.example'],
    ['backslash trick', '/\\evil.example'],
    ['backslash later in the path', '/ok\\..\\evil'],
    ['absolute URL', 'https://evil.example'],
    ['scheme', 'javascript:alert(1)'],
    ['whitespace', '/ x'],
    ['control character', '/x\u0000y'],
    ['empty', ''],
    ['no leading slash', 'dashboard'],
    ['too long', `/${'a'.repeat(600)}`],
  ])('rejects %s', (_case, path) => {
    expect(returnToSchema.safeParse(path).success).toBe(false);
  });
});

describe('webRedirectUrl', () => {
  it('joins the web origin and the path', () => {
    expect(webRedirectUrl('http://localhost:3000', '/dashboard?x=1')).toBe(
      'http://localhost:3000/dashboard?x=1',
    );
  });

  it('never leaves the web origin', () => {
    expect(() => webRedirectUrl('http://localhost:3000', '//evil.example')).toThrow();
  });
});

describe('OAuth state', () => {
  it('creates distinct random values and a 10-minute expiry', () => {
    const now = 1_000_000;
    const a = createOAuthState('/x', now);
    const b = createOAuthState('/x', now);
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.verifier.length).toBeGreaterThanOrEqual(43);
    expect(a).toMatchObject({ returnTo: '/x', exp: now + OAUTH_STATE_TTL_MS });
  });

  it('round-trips through the cookie value', () => {
    const state = createOAuthState('/x', 0);
    expect(parseOAuthState(JSON.stringify(state), 1)).toEqual(state);
  });

  it.each([
    ['not a string', 42],
    ['unsigned or tampered (cookie-parser gives false)', false],
    ['not JSON', '{nope'],
    ['missing fields', JSON.stringify({ state: 'x' })],
    ['an unsafe returnTo', JSON.stringify({ ...createOAuthState('/x', 0), returnTo: '//evil' })],
  ])('rejects %s', (_case, raw) => {
    expect(parseOAuthState(raw, 1)).toBeNull();
  });

  it('rejects an expired state', () => {
    const state = createOAuthState('/x', 0);
    expect(parseOAuthState(JSON.stringify(state), OAUTH_STATE_TTL_MS + 1)).toBeNull();
  });

  it('derives the S256 PKCE challenge', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(codeChallengeFor(verifier)).toBe(
      createHash('sha256').update(verifier).digest('base64url'),
    );
  });

  it('compares states exactly', () => {
    expect(sameState('abc', 'abc')).toBe(true);
    expect(sameState('abc', 'abd')).toBe(false);
    expect(sameState('abc', 'abcd')).toBe(false);
    expect(sameState('abc', undefined)).toBe(false);
  });
});
