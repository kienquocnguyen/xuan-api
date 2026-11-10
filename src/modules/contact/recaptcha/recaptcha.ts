/** The action name the web passes to `grecaptcha.execute` for the contact form (contract identifier). */
export const RECAPTCHA_ACTION = 'contact_submit';

/** The action name the web passes to `grecaptcha.execute` for the coaching registration form (contract identifier). */
export const COACHING_RECAPTCHA_ACTION = 'coaching_registration_submit';

/** Google's siteverify answer, camel-cased. Google itself refuses reused or expired tokens. */
export type SiteVerifyResult = Readonly<{
  success: boolean;
  score?: number;
  action?: string;
  hostname?: string;
  challengeTs?: string;
  errorCodes: readonly string[];
}>;

export const RECAPTCHA_VERIFIER = Symbol('RECAPTCHA_VERIFIER');

/** Gateway to Google reCAPTCHA (C5). E2E tests replace it with a fake; nothing else talks to Google. */
export interface RecaptchaVerifier {
  /** Throws RecaptchaUnavailableError when Google can't give an answer; never guesses a pass. */
  verify(token: string, remoteIp: string | null): Promise<SiteVerifyResult>;
}

export class RecaptchaUnavailableError extends Error {
  constructor(reason: string) {
    super(`reCAPTCHA verification unavailable: ${reason}`);
    this.name = 'RecaptchaUnavailableError';
  }
}

export type RecaptchaPolicy = Readonly<{ allowedHostnames: readonly string[]; minScore: number }>;
export type RecaptchaVerdict =
  'pass' | 'not_successful' | 'wrong_action' | 'wrong_hostname' | 'low_score';

/**
 * Our own checks on top of Google's (contact form design CF-4). The verdict is logged, never sent.
 * Token expiry and reuse are left to Google (`timeout-or-duplicate`): `challenge_ts` is when the
 * widget loaded, not when the token was made, so an age bound refused people who took their time.
 */
export function assessRecaptcha(
  result: SiteVerifyResult,
  policy: RecaptchaPolicy,
  expectedAction: string,
): RecaptchaVerdict {
  if (!result.success) return 'not_successful';
  if (result.action !== expectedAction) return 'wrong_action';
  if (!result.hostname || !policy.allowedHostnames.includes(result.hostname.toLowerCase()))
    return 'wrong_hostname';
  if (result.score === undefined || result.score < policy.minScore) return 'low_score';
  return 'pass';
}

/** Seconds since the reCAPTCHA challenge loaded (negative if Google's clock is ahead), or null. For logs only. */
export function challengeAgeSeconds(result: SiteVerifyResult, now: Date): number | null {
  const loaded = result.challengeTs ? Date.parse(result.challengeTs) : Number.NaN;
  return Number.isNaN(loaded) ? null : Math.round((now.getTime() - loaded) / 1000);
}
