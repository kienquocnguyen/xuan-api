import type { ErrorDefinition } from '../../errors/app-error.js';

/** Users-module error codes (D10). */
export const usersErrors = {
  ADMIN_ROLE_LOCKED: {
    code: 'ADMIN_ROLE_LOCKED',
    kind: 'conflict',
    message: 'Admin roles cannot be changed here.',
  },
} as const satisfies Record<string, ErrorDefinition>;

/**
 * Why a Google sign-in was refused. The callback is a browser navigation, so these become
 * `/login?authError=<code>` redirects to the web app rather than JSON errors (auth design §4).
 */
export type SignInFailure = 'GOOGLE_SIGN_IN_FAILED' | 'EMAIL_NOT_VERIFIED' | 'ACCOUNT_CONFLICT';

export class SignInError extends Error {
  constructor(readonly code: SignInFailure) {
    super(code);
    this.name = 'SignInError';
  }
}
