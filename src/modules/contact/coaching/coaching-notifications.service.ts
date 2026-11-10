import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { APP_CONFIG } from '../../../config/app-config.module.js';
import type { AppConfig } from '../../../config/load-config.js';
import {
  CONTACT_NOTIFIER,
  type ContactNotifier,
  NotificationDeliveryError,
} from '../notifications/contact-notifier.js';
import type { RetryOutcome } from '../notifications/contact-notifications.service.js';
import { STALE_ATTEMPT_SECONDS } from '../notifications/stale-attempt.js';
import {
  buildCoachingNotificationEmail,
  type NotifiedRegistration,
} from './coaching-notification-email.js';

/** The answers the email shows, as `NotifiedRegistration` fields. */
const REGISTRATION_COLUMNS = `id, program, name, email, youtube_stage AS "youtubeStage",
  youtube_channel_url AS "youtubeChannelUrl", expertise, goals, challenges,
  challenge_other AS "challengeOther", desired_outcome AS "desiredOutcome",
  practice_commitment AS "practiceCommitment", favorite_creators AS "favoriteCreators",
  phone, created_at AS "createdAt"`;

/**
 * The business-inbox email for a new coaching registration (CR-12), on the contact form's notifier and rules
 * (CF-10 to CF-13): one attempt per new registration, awaited in the request, and an admin's manual retry.
 * `sent` only after the provider accepted.
 */
@Injectable()
export class CoachingNotificationsService {
  private readonly logger = new Logger(CoachingNotificationsService.name);
  private readonly adminUrl: string;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(CONTACT_NOTIFIER) private readonly notifier: ContactNotifier,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.adminUrl = `${config.auth.webUrl}/admin/coaching`;
  }

  /** Whether an attempt is possible at all. Without a provider, new registrations are stored as `failed`. */
  get enabled(): boolean {
    return this.notifier.enabled;
  }

  /**
   * The one attempt for a just-committed registration, inserted `pending` with its attempt claimed. Never throws:
   * the registration is already stored, so a delivery problem must not turn the visitor's success into an error.
   * An unexpected failure leaves the row `pending`; an admin can retry it once it's stale.
   */
  async deliverNew(registration: NotifiedRegistration): Promise<void> {
    try {
      await this.attempt(registration);
    } catch (error) {
      this.logger.error(
        `Coaching notification ${registration.id}: delivery step failed after the registration was stored.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * An admin's retry; the caller checks `enabled` first. One attempt now for a `failed` notification, or a `pending`
   * one whose attempt is stale. The claim is one conditional UPDATE, so of two concurrent retries only one sends.
   */
  async retry(registrationId: string): Promise<RetryOutcome> {
    const [rows] = await this.dataSource.query<[NotifiedRegistration[], number]>(
      `UPDATE coaching_registrations
          SET notification_status = 'pending', notification_attempts = notification_attempts + 1,
              notification_attempted_at = now(), notification_last_error = NULL, updated_at = now()
        WHERE id = $1
          AND (notification_status = 'failed'
               OR (notification_status = 'pending'
                   AND notification_attempted_at < now() - make_interval(secs => $2)))
        RETURNING ${REGISTRATION_COLUMNS}`,
      [registrationId, STALE_ATTEMPT_SECONDS],
    );
    const [claimed] = rows;
    return claimed ? this.attempt(claimed) : 'not_retryable';
  }

  private async attempt(row: NotifiedRegistration): Promise<'sent' | 'failed'> {
    let providerMessageId: string;
    try {
      // Stable per registration: a retry after a lost response is a no-op at the provider (CF-12).
      ({ providerMessageId } = await this.notifier.send(
        buildCoachingNotificationEmail(row, this.adminUrl),
        `coaching-registration-${row.id}`,
      ));
    } catch (error) {
      if (!(error instanceof NotificationDeliveryError)) throw error; // stays pending, retryable once stale
      await this.dataSource.query(
        `UPDATE coaching_registrations
            SET notification_status = 'failed', notification_last_error = $2, updated_at = now()
          WHERE id = $1 AND notification_status = 'pending'`,
        [row.id, error.category],
      );
      // Id and category only: never the registrant's answers or the provider's answer (I17).
      this.logger.warn(`Coaching notification ${row.id} failed: ${error.category}.`);
      return 'failed';
    }
    await this.dataSource.query(
      `UPDATE coaching_registrations
          SET notification_status = 'sent', notification_sent_at = now(),
              notification_last_error = NULL, notification_provider_message_id = $2,
              updated_at = now()
        WHERE id = $1`,
      [row.id, providerMessageId],
    );
    return 'sent';
  }
}
