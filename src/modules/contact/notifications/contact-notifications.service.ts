import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import {
  CONTACT_NOTIFIER,
  type ContactNotifier,
  NotificationDeliveryError,
} from './contact-notifier.js';
import { buildNotificationEmail, type NotifiedSubmission } from './notification-email.js';

/**
 * A `pending` attempt older than this was interrupted (the request died, or the outcome couldn't be written), so an
 * admin may retry it. An attempt lasts at most the 8 s provider timeout plus two short writes, so a live attempt is
 * never retried.
 */
export const STALE_ATTEMPT_SECONDS = 600;

export type RetryOutcome = 'sent' | 'failed' | 'not_retryable';

/**
 * The business-inbox notification (contact form design CF-9 to CF-13): one attempt per new submission, awaited in
 * the request, and an admin's manual retry. No schedule, no automatic retry. `sent` only after the provider accepted.
 */
@Injectable()
export class ContactNotificationsService {
  private readonly logger = new Logger(ContactNotificationsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(CONTACT_NOTIFIER) private readonly notifier: ContactNotifier,
  ) {}

  /** Whether an attempt is possible at all. Without a provider, new submissions are stored as `failed`. */
  get enabled(): boolean {
    return this.notifier.enabled;
  }

  /**
   * The one attempt for a just-committed submission, which was inserted `pending` with its attempt claimed (CF-11).
   * Never throws: the submission is already stored, so a delivery problem must not turn the visitor's success into
   * an error. An unexpected failure leaves the row `pending`; an admin can retry it once it's stale.
   */
  async deliverNew(submission: NotifiedSubmission): Promise<void> {
    try {
      await this.attempt(submission);
    } catch (error) {
      this.logger.error(
        `Contact notification ${submission.id}: delivery step failed after the submission was stored.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * An admin's retry (CF-13); the caller checks `enabled` first. One attempt now for a `failed` notification, or a `pending` one whose attempt is
   * stale. The claim is one conditional UPDATE, so of two concurrent retries only one sends.
   */
  async retry(submissionId: string): Promise<RetryOutcome> {
    const [rows] = await this.dataSource.query<[NotifiedSubmission[], number]>(
      `UPDATE contact_submissions
          SET notification_status = 'pending', notification_attempts = notification_attempts + 1,
              notification_attempted_at = now(), notification_last_error = NULL, updated_at = now()
        WHERE id = $1
          AND (notification_status = 'failed'
               OR (notification_status = 'pending'
                   AND notification_attempted_at < now() - make_interval(secs => $2)))
        RETURNING id, name, email, subject, message, created_at AS "createdAt"`,
      [submissionId, STALE_ATTEMPT_SECONDS],
    );
    const [claimed] = rows;
    return claimed ? this.attempt(claimed) : 'not_retryable';
  }

  private async attempt(row: NotifiedSubmission): Promise<'sent' | 'failed'> {
    let providerMessageId: string;
    try {
      // The key is stable per submission: a retry after a lost response is a no-op at the provider (CF-12).
      ({ providerMessageId } = await this.notifier.send(
        buildNotificationEmail(row),
        `contact-submission-${row.id}`,
      ));
    } catch (error) {
      if (!(error instanceof NotificationDeliveryError)) throw error; // stays pending, retryable once stale
      await this.dataSource.query(
        `UPDATE contact_submissions
            SET notification_status = 'failed', notification_last_error = $2, updated_at = now()
          WHERE id = $1 AND notification_status = 'pending'`,
        [row.id, error.category],
      );
      // Id and category only: never the visitor's data or the provider's answer (I17).
      this.logger.warn(`Contact notification ${row.id} failed: ${error.category}.`);
      return 'failed';
    }
    await this.dataSource.query(
      `UPDATE contact_submissions
          SET notification_status = 'sent', notification_sent_at = now(),
              notification_last_error = NULL, notification_provider_message_id = $2,
              updated_at = now()
        WHERE id = $1`,
      [row.id, providerMessageId],
    );
    return 'sent';
  }
}
