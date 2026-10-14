import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import type { GoogleIdentity, GoogleIdentityGateway } from './google-identity.gateway.js';

export type GoogleOAuthSettings = Readonly<{
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}>;

/**
 * google-auth-library adapter: authorization code flow with PKCE (S256), state and nonce. The ID token is
 * verified by the library (signature, audience, issuer, expiry); the nonce is checked here. Google's access
 * and refresh tokens are discarded: the app keeps only the identity (auth design A1, A2).
 */
export class GoogleOAuthGateway implements GoogleIdentityGateway {
  private readonly client: OAuth2Client;

  constructor(private readonly settings: GoogleOAuthSettings) {
    this.client = new OAuth2Client({
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
      redirectUri: settings.callbackUrl,
    });
  }

  authorizationUrl(input: { state: string; codeChallenge: string; nonce: string }): string {
    return this.client.generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      prompt: 'select_account',
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
  }

  async exchangeCode(input: {
    code: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<GoogleIdentity> {
    const { tokens } = await this.client.getToken({
      code: input.code,
      codeVerifier: input.codeVerifier,
    });
    if (!tokens.id_token) throw new Error('Google returned no ID token.');
    const ticket = await this.client.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.settings.clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) throw new Error('Google ID token lacks sub or email.');
    if (payload.nonce !== input.nonce) throw new Error('Google ID token nonce mismatch.');
    return {
      subject: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      name: payload.name,
      picture: payload.picture,
    };
  }
}
