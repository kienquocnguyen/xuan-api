import {
  type ContactNotifier,
  NotificationDeliveryError,
  type NotificationEmail,
} from './contact-notifier.js';

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

export type ResendSettings = Readonly<{ apiKey: string; from: string; to: string }>;

/**
 * Resend's HTTP API with plain `fetch` (no SDK). Success means a 2xx carrying a message id, nothing less (CF-10).
 * The `Idempotency-Key` makes a retry after a lost response a no-op at Resend for 24 hours (CF-12).
 */
export class ResendContactNotifier implements ContactNotifier {
  readonly enabled = true;

  constructor(
    private readonly settings: ResendSettings,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 8000,
  ) {}

  async send(
    email: NotificationEmail,
    idempotencyKey: string,
  ): Promise<{ providerMessageId: string }> {
    let response: Response;
    try {
      response = await this.fetchFn(RESEND_EMAILS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.settings.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          from: this.settings.from,
          to: [this.settings.to],
          reply_to: email.replyTo,
          subject: email.subject,
          text: email.text,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new NotificationDeliveryError(timedOut ? 'TIMEOUT' : 'NETWORK_ERROR');
    }
    if (response.status === 429 || response.status >= 500)
      throw new NotificationDeliveryError('PROVIDER_UNAVAILABLE');
    if (!response.ok) throw new NotificationDeliveryError('PROVIDER_REJECTED');
    const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
    if (typeof body?.id !== 'string' || body.id.length === 0)
      throw new NotificationDeliveryError('INVALID_RESPONSE');
    return { providerMessageId: body.id };
  }
}
