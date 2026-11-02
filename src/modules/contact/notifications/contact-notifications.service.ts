import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { ContactSubject } from '../contact-subjects.js';
import {
  CONTACT_NOTIFIER,
  type ContactNotifier,
  NotificationDeliveryError,
} from './contact-notifier.js';
import { buildNotificationEmail } from './notification-email.js';
import { ATTEMPT_LEASE_SECONDS, retryDelaySeconds } from './notification-schedule.js';

/** Due notifications sent after a successful inline one, in the same request (CF-13a). */
const PIGGYBACK_LIMIT = 2;

type ClaimedRow = {
  id: string;
  name: string;
  email: string;
  subject: ContactSubject;
  message: string;
  createdAt: Date;
  attempts: number;
};

export type AttemptOutcome = 'sent' | 'retrying' | 'failed';
export type SweepSummary = { attempted: number; sent: number; retrying: number; failed: number };

/**
 * Delivery of the business-inbox notification (contact form design CF-10 to CF-13). Every attempt is claimed first
 * (attempts + 1, a lease on `notification_next_attempt_at`), so concurrent sweeps never pick the same row; the
 * outcome is written after the provider answered. `sent` only after the provider accepted.
 */
@Injectable()
export class ContactNotificationsService {
  private readonly logger = new Logger(ContactNotificationsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(CONTACT_NOTIFIER) private readonly notifier: ContactNotifier,
  ) {}

  /**
   * The inline attempt for a just-committed submission (CF-11). Never throws: the submission is already stored,
   * so a delivery problem must not turn the visitor's success into an error.
   */
  async deliverNew(submissionId: string): Promise<void> {
    if (!this.notifier.enabled) {
      this.logger.warn(`Contact notification ${submissionId} waits: no email provider configured.`);
      return;
    }
    try {
      const [claimed] = await this.claim(
        `id = $2 AND notification_status = 'pending' AND notification_next_attempt_at <= now()`,
        [submissionId],
        1,
      );
      if (!claimed) return;
      if ((await this.attempt(claimed)) === 'sent') await this.deliverDue(PIGGYBACK_LIMIT);
    } catch (error) {
      this.logger.error(
        `Contact notification ${submissionId}: delivery step failed after the submission was stored.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Sends up to `limit` due notifications, oldest due first (CF-13a, b). */
  async deliverDue(limit: number): Promise<SweepSummary> {
    const summary: SweepSummary = { attempted: 0, sent: 0, retrying: 0, failed: 0 };
    if (!this.notifier.enabled) return summary;
    const claimed = await this.claim(
      `notification_status = 'pending' AND notification_next_attempt_at <= now()`,
      [],
      limit,
    );
    for (const row of claimed) {
      summary.attempted += 1;
      summary[await this.attempt(row)] += 1;
    }
    return summary;
  }

  /**
   * An admin's retry (CF-13c): one attempt now, whatever the schedule, also after automatic attempts ran out.
   * A sent notification is left alone. Returns `null` when nothing was attempted.
   */
  async retry(submissionId: string): Promise<AttemptOutcome | null> {
    if (!this.notifier.enabled) return null;
    const [claimed] = await this.claim(
      `id = $2 AND notification_status <> 'sent'`,
      [submissionId],
      1,
    );
    return claimed ? this.attempt(claimed) : null;
  }

  private async claim(condition: string, params: unknown[], limit: number): Promise<ClaimedRow[]> {
    const [rows] = await this.dataSource.query<[ClaimedRow[], number]>(
      `UPDATE contact_submissions
          SET notification_attempts = notification_attempts + 1,
              notification_status = 'pending',
              notification_next_attempt_at = now() + make_interval(secs => ${ATTEMPT_LEASE_SECONDS}),
              updated_at = now()
        WHERE id IN (
          SELECT id FROM contact_submissions
           WHERE ${condition}
           ORDER BY notification_next_attempt_at, id
           LIMIT $1
           FOR UPDATE SKIP LOCKED)
        RETURNING id, name, email, subject, message, created_at AS "createdAt",
                  notification_attempts AS attempts`,
      [limit, ...params],
    );
    return rows;
  }

  private async attempt(row: ClaimedRow): Promise<AttemptOutcome> {
    let providerMessageId: string;
    try {
      ({ providerMessageId } = await this.notifier.send(
        buildNotificationEmail(row),
        `contact-submission-${row.id}`,
      ));
    } catch (error) {
      if (!(error instanceof NotificationDeliveryError)) throw error; // the lease retries it later
      return this.recordFailure(row, error);
    }
    await this.dataSource.query(
      `UPDATE contact_submissions
          SET notification_status = 'sent', notification_sent_at = now(),
              notification_next_attempt_at = NULL, notification_last_error = NULL,
              notification_provider_message_id = $2, updated_at = now()
        WHERE id = $1`,
      [row.id, providerMessageId],
    );
    return 'sent';
  }

  private async recordFailure(
    row: ClaimedRow,
    error: NotificationDeliveryError,
  ): Promise<AttemptOutcome> {
    const delay = retryDelaySeconds(row.attempts);
    // Never downgrade a notification that a concurrent attempt already sent.
    await this.dataSource.query(
      `UPDATE contact_submissions
          SET notification_status = $2,
              notification_next_attempt_at = CASE WHEN $3::int IS NULL THEN NULL
                                                  ELSE now() + make_interval(secs => $3::int) END,
              notification_last_error = $4, updated_at = now()
        WHERE id = $1 AND notification_status <> 'sent'`,
      [row.id, delay === null ? 'failed' : 'pending', delay, error.category],
    );
    // Id, attempt and category only: never the visitor's data or the provider's answer (I17).
    this.logger.warn(
      `Contact notification ${row.id} attempt ${row.attempts} failed: ${error.category}` +
        (delay === null ? '; no automatic attempt left.' : `; next in ${delay} s.`),
    );
    return delay === null ? 'failed' : 'retrying';
  }
}
