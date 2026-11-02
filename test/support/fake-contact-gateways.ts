import {
  type ContactNotifier,
  NotificationDeliveryError,
  type NotificationEmail,
  type NotificationErrorCategory,
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

/** Test double for the email provider: records accepted emails and fails on request. Never sends anything. */
export class FakeContactNotifier implements ContactNotifier {
  enabled = true;
  readonly sent: { email: NotificationEmail; idempotencyKey: string; providerMessageId: string }[] =
    [];
  attempts = 0;
  private failures: NotificationErrorCategory[] = [];

  /** The next sends fail with these categories, in order; later ones succeed. */
  willFail(...categories: NotificationErrorCategory[]): void {
    this.failures.push(...categories);
  }

  async send(
    email: NotificationEmail,
    idempotencyKey: string,
  ): Promise<{ providerMessageId: string }> {
    this.attempts += 1;
    const failure = this.failures.shift();
    if (failure) throw new NotificationDeliveryError(failure);
    const providerMessageId = `fake-${this.attempts}`;
    this.sent.push({ email, idempotencyKey, providerMessageId });
    return { providerMessageId };
  }

  reset(): void {
    this.enabled = true;
    this.sent.length = 0;
    this.attempts = 0;
    this.failures = [];
  }
}
