import {
  type RecaptchaVerifier,
  RecaptchaUnavailableError,
  type SiteVerifyResult,
} from './recaptcha.js';

const SITEVERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

type SiteVerifyBody = {
  success?: unknown;
  score?: unknown;
  action?: unknown;
  hostname?: unknown;
  challenge_ts?: unknown;
  'error-codes'?: unknown;
};

const optional = <T>(value: unknown, type: 'string' | 'number') =>
  typeof value === type ? (value as T) : undefined;

/** reCAPTCHA v3 through Google's siteverify endpoint. The secret travels only in the POST body. */
export class GoogleRecaptchaVerifier implements RecaptchaVerifier {
  constructor(
    private readonly secretKey: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 5000,
  ) {}

  async verify(token: string, remoteIp: string | null): Promise<SiteVerifyResult> {
    const form = new URLSearchParams({ secret: this.secretKey, response: token });
    if (remoteIp) form.set('remoteip', remoteIp);
    let body: SiteVerifyBody;
    try {
      const response = await this.fetchFn(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new RecaptchaUnavailableError(`HTTP ${response.status}`);
      body = (await response.json()) as SiteVerifyBody;
    } catch (error) {
      if (error instanceof RecaptchaUnavailableError) throw error;
      // Timeouts, network failures and unreadable bodies; the cause's message never carries the secret.
      throw new RecaptchaUnavailableError(error instanceof Error ? error.name : 'unknown');
    }
    if (typeof body?.success !== 'boolean')
      throw new RecaptchaUnavailableError('unexpected answer');
    const errorCodes = body['error-codes'];
    return {
      success: body.success,
      score: optional<number>(body.score, 'number'),
      action: optional<string>(body.action, 'string'),
      hostname: optional<string>(body.hostname, 'string'),
      challengeTs: optional<string>(body.challenge_ts, 'string'),
      errorCodes: Array.isArray(errorCodes)
        ? errorCodes.filter((code): code is string => typeof code === 'string')
        : [],
    };
  }
}
