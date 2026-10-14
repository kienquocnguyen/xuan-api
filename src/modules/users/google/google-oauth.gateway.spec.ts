import { GoogleOAuthGateway } from './google-oauth.gateway.js';

const settings = {
  clientId: 'client-123.apps.googleusercontent.com',
  clientSecret: 'never-in-url',
  callbackUrl: 'http://localhost:4000/auth/google/callback',
};

describe('GoogleOAuthGateway.authorizationUrl', () => {
  const url = new URL(
    new GoogleOAuthGateway(settings).authorizationUrl({
      state: 'state-1',
      codeChallenge: 'challenge-1',
      nonce: 'nonce-1',
    }),
  );

  it('targets Google with the authorization code flow', () => {
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(settings.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(settings.callbackUrl);
  });

  it('asks only for identity scopes and lets the user pick an account', () => {
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('prompt')).toBe('select_account');
  });

  it('carries state, nonce and an S256 PKCE challenge', () => {
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('nonce')).toBe('nonce-1');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('never puts the client secret in the URL', () => {
    expect(url.toString()).not.toContain(settings.clientSecret);
  });
});
