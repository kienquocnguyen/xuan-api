import {
  type ContactNotifier,
  type DeliveryErrorCategory,
  NotificationDeliveryError,
  type NotificationEmail,
} from '../../src/modules/contact/notifications/contact-notifier.js';
import {
  RECAPTCHA_ACTION,
  type RecaptchaVerifier,
  RecaptchaUnavailableError,
  type SiteVerifyResult,
} from '../../src/modules/contact/recaptcha/recaptcha.js';

/** The hostname createTestApp's reCAPTCHA settings accept. */
export const RECAPTCHA_TEST_HOSTNAME = 'xuancreative.test';
/** A token the fake answers like a fresh human token for the contact action. */
export const HUMAN_TOKEN = 'human-token';

/**
 * Test double for Google siteverify (never contacts Google). By default every token is a fresh human pass, used
 * once like Google's: a second verification of one token is `timeout-or-duplicate`.
 */
export class FakeRecaptchaVerifier implements RecaptchaVerifier {
  readonly calls: { token: string; remoteIp: string | null }[] = [];
  private readonly answers = new Map<string, Partial<SiteVerifyResult> | 'unavailable'>();
  private readonly used = new Set<string>();

  /** The next verification of `token` answers with these fields over a passing result, or fails to answer. */
  willAnswer(token: string, answer: Partial<SiteVerifyResult> | 'unavailable'): void {
    this.answers.set(token, answer);
  }

  async verify(token: string, remoteIp: string | null): Promise<SiteVerifyResult> {
    this.calls.push({ token, remoteIp });
    const answer = this.answers.get(token);
    if (answer === 'unavailable') throw new RecaptchaUnavailableError('fake outage');
    if (this.used.has(token)) return { success: false, errorCodes: ['timeout-or-duplicate'] };
    this.used.add(token);
    return {
      success: true,
      score: 0.9,
      action: RECAPTCHA_ACTION,
      hostname: RECAPTCHA_TEST_HOSTNAME,
      challengeTs: new Date().toISOString(),
      errorCodes: [],
      ...answer,
    };
  }

  reset(): void {
    this.calls.length = 0;
    this.answers.clear();
    this.used.clear();
  }
}

type FakeFailure = DeliveryErrorCategory | 'unexpected' | 'lost_response';

/**
 * Test double for the email provider. Never sends anything. Like Resend's `Idempotency-Key`, a repeated key is
 * answered with the first acceptance and delivers no second email, so `sent` holds one entry per delivered email.
 */
export class FakeContactNotifier implements ContactNotifier {
  enabled = true;
  /** Emails the provider accepted, one per idempotency key. */
  readonly sent: { email: NotificationEmail; idempotencyKey: string; providerMessageId: string }[] =
    [];
  attempts = 0;
  private failures: FakeFailure[] = [];
  private delayMs = 0;

  /**
   * The next sends fail like this, in order; later ones succeed. `unexpected` throws a plain error (a bug, or a lost
   * database connection). `lost_response`: the provider accepts the email, then the answer never arrives (TIMEOUT).
   */
  willFail(...failures: FakeFailure[]): void {
    this.failures.push(...failures);
  }

  /** Every send takes this long, so concurrent requests overlap. */
  slowDown(ms: number): void {
    this.delayMs = ms;
  }

  async send(
    email: NotificationEmail,
    idempotencyKey: string,
  ): Promise<{ providerMessageId: string }> {
    this.attempts += 1;
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const failure = this.failures.shift();
    if (failure === 'unexpected') throw new Error('unexpected failure');
    if (failure && failure !== 'lost_response') throw new NotificationDeliveryError(failure);
    let accepted = this.sent.find((entry) => entry.idempotencyKey === idempotencyKey);
    if (!accepted) {
      accepted = { email, idempotencyKey, providerMessageId: `fake-${this.sent.length + 1}` };
      this.sent.push(accepted);
    }
    if (failure === 'lost_response') throw new NotificationDeliveryError('TIMEOUT');
    return { providerMessageId: accepted.providerMessageId };
  }

  reset(): void {
    this.enabled = true;
    this.sent.length = 0;
    this.attempts = 0;
    this.failures = [];
    this.delayMs = 0;
  }
}
