/** What the app needs from Google after a successful sign-in (auth design A2). Never tokens. */
export type GoogleIdentity = Readonly<{
  /** Google's stable account id (`sub`). */
  subject: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}>;

export const GOOGLE_IDENTITY_GATEWAY = Symbol('GOOGLE_IDENTITY_GATEWAY');

/** Gateway to Google (C5). E2E tests replace it with a fake; nothing else talks to Google. */
export interface GoogleIdentityGateway {
  authorizationUrl(input: { state: string; codeChallenge: string; nonce: string }): string;
  /** Exchanges the code (PKCE) and verifies the ID token, including its nonce. Throws on any failure. */
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<GoogleIdentity>;
}
