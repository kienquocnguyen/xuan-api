import type { AppConfig } from '../../../config/load-config.js';
import { ResendContactNotifier } from './resend-contact-notifier.js';

/** Why an attempt failed; stored in `notification_last_error` (a category, never a provider body). */
export const NOTIFICATION_ERROR_CATEGORIES = [
  'TIMEOUT',
  'NETWORK_ERROR',
  'PROVIDER_REJECTED',
  'PROVIDER_UNAVAILABLE',
  'INVALID_RESPONSE',
] as const;
export type NotificationErrorCategory = (typeof NOTIFICATION_ERROR_CATEGORIES)[number];

export class NotificationDeliveryError extends Error {
  constructor(readonly category: NotificationErrorCategory) {
    super(`Notification delivery failed: ${category}`);
    this.name = 'NotificationDeliveryError';
  }
}

/** One email to the business inbox. Sender, recipient and credentials belong to the adapter. */
export type NotificationEmail = Readonly<{ subject: string; text: string; replyTo: string }>;

export const CONTACT_NOTIFIER = Symbol('CONTACT_NOTIFIER');

/**
 * Gateway to the transactional email provider (C5; contact form design CF-9). `send` resolves only once the
 * provider accepted the message, and throws NotificationDeliveryError otherwise. E2E tests replace it with a fake.
 */
export interface ContactNotifier {
  /** `false` without provider configuration: notifications stay pending, nothing is attempted. */
  readonly enabled: boolean;
  send(email: NotificationEmail, idempotencyKey: string): Promise<{ providerMessageId: string }>;
}

export class DisabledContactNotifier implements ContactNotifier {
  readonly enabled = false;

  send(): Promise<{ providerMessageId: string }> {
    return Promise.reject(new Error('Contact notifications are not configured.'));
  }
}

export function createContactNotifier(config: AppConfig): ContactNotifier {
  const { email } = config.contact;
  return email.provider === 'resend'
    ? new ResendContactNotifier(email)
    : new DisabledContactNotifier();
}
