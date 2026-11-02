/** The action name the web passes to `grecaptcha.execute` for the contact form (contract identifier). */
export const RECAPTCHA_ACTION = 'contact_submit';

/** Tokens live 2 minutes at Google; the extra minute absorbs clock skew. */
const MAX_CHALLENGE_AGE_MS = 180_000;
const MAX_CLOCK_AHEAD_MS = 60_000;

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
  'pass' | 'not_successful' | 'wrong_action' | 'wrong_hostname' | 'low_score' | 'stale_challenge';

/** Our own checks on top of Google's (contact form design CF-4). The verdict is logged, never sent. */
export function assessRecaptcha(
  result: SiteVerifyResult,
  policy: RecaptchaPolicy,
  now: Date,
): RecaptchaVerdict {
  if (!result.success) return 'not_successful';
  if (result.action !== RECAPTCHA_ACTION) return 'wrong_action';
  if (!result.hostname || !policy.allowedHostnames.includes(result.hostname.toLowerCase()))
    return 'wrong_hostname';
  if (result.score === undefined || result.score < policy.minScore) return 'low_score';
  const issued = result.challengeTs ? Date.parse(result.challengeTs) : Number.NaN;
  const age = now.getTime() - issued;
  if (Number.isNaN(issued) || age > MAX_CHALLENGE_AGE_MS || age < -MAX_CLOCK_AHEAD_MS)
    return 'stale_challenge';
  return 'pass';
}
