import { createHash } from 'node:crypto';
import type {
  GoogleIdentity,
  GoogleIdentityGateway,
} from '../../src/modules/users/google/google-identity.gateway.js';

/**
 * Test double for Google (never contacts Google). Behaves like the real flow where it matters: a code is
 * single-use, and the exchange succeeds only with the PKCE verifier and nonce issued at authorization.
 */
export class FakeGoogleIdentityGateway implements GoogleIdentityGateway {
  private readonly nonceByChallenge = new Map<string, string>();
  private readonly outcomes = new Map<string, GoogleIdentity | 'fail'>();

  authorizationUrl(input: { state: string; codeChallenge: string; nonce: string }): string {
    this.nonceByChallenge.set(input.codeChallenge, input.nonce);
    const query = new URLSearchParams({
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
    });
    return `https://accounts.google.test/o/oauth2/v2/auth?${query}`;
  }

  /** The next exchange of `code` returns `identity`. */
  willReturn(code: string, identity: GoogleIdentity): void {
    this.outcomes.set(code, identity);
  }

  /** The next exchange of `code` fails, like an invalid_grant from Google. */
  willFail(code: string): void {
    this.outcomes.set(code, 'fail');
  }

  async exchangeCode(input: {
    code: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<GoogleIdentity> {
    const outcome = this.outcomes.get(input.code);
    this.outcomes.delete(input.code); // codes are single-use
    if (!outcome || outcome === 'fail') throw new Error('invalid_grant');
    const challenge = createHash('sha256').update(input.codeVerifier).digest('base64url');
    if (this.nonceByChallenge.get(challenge) !== input.nonce) {
      throw new Error('PKCE verifier or nonce mismatch');
    }
    return outcome;
  }
}
