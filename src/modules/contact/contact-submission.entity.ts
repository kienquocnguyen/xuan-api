import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ContactSubject } from './contact-subjects.js';
import type { NotificationErrorCategory } from './notifications/contact-notifier.js';

/** The minimal inbox (contact form design CF-14). */
export const CONTACT_SUBMISSION_STATUSES = ['new', 'read', 'archived'] as const;
export type ContactSubmissionStatus = (typeof CONTACT_SUBMISSION_STATUSES)[number];

/**
 * `pending` while an attempt runs (or if it was interrupted), `sent` only once the provider accepted the email,
 * `failed` when the attempt failed or no provider is configured (contact form design CF-10).
 */
export const NOTIFICATION_STATUSES = ['pending', 'sent', 'failed'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/**
 * `contact_submissions` (database.md §12): a message from the public contact form, with its inbox status and the
 * delivery state of its notification email. Never deleted in V1.
 */
@Entity('contact_submissions')
@Index('ix_contact_submissions_status_created_at_id', ['status', 'createdAt', 'id'])
@Index('ix_contact_submissions_email_created_at', ['email', 'createdAt'])
@Index('ix_contact_submissions_client_ip_hash_created_at', ['clientIpHash', 'createdAt'])
@Check('ck_contact_submissions_name_not_blank', `"name" ~ '[^[:space:]]'`)
@Check('ck_contact_submissions_email_lowercase', `"email" = lower("email")`)
@Check(
  'ck_contact_submissions_subject',
  `"subject" IN ('youtube_editing_course', 'channel_kickstart_session', 'youtube_coaching_3_months', 'general')`,
)
@Check('ck_contact_submissions_message_not_blank', `"message" ~ '[^[:space:]]'`)
@Check('ck_contact_submissions_status', `"status" IN ('new', 'read', 'archived')`)
@Check(
  'ck_contact_submissions_notification_status',
  `"notification_status" IN ('pending', 'sent', 'failed')`,
)
@Check('ck_contact_submissions_notification_attempts', `"notification_attempts" >= 0`)
@Check(
  'ck_contact_submissions_notification_pending_attempt',
  `"notification_status" <> 'pending' OR "notification_attempted_at" IS NOT NULL`,
)
@Check(
  'ck_contact_submissions_notification_failed_error',
  `"notification_status" <> 'failed' OR "notification_last_error" IS NOT NULL`,
)
@Check(
  'ck_contact_submissions_notification_last_error',
  `"notification_last_error" IN ('NOT_CONFIGURED', 'TIMEOUT', 'NETWORK_ERROR', 'PROVIDER_REJECTED', 'PROVIDER_UNAVAILABLE', 'INVALID_RESPONSE')`,
)
@Check(
  'ck_contact_submissions_notification_sent_pair',
  `("notification_status" = 'sent') = ("notification_sent_at" IS NOT NULL)`,
)
export class ContactSubmission {
  @PrimaryColumn({
    type: 'uuid',
    default: () => 'uuidv7()',
    primaryKeyConstraintName: 'pk_contact_submissions',
  })
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /** Lowercase (D30), so per-email limits and duplicates compare one canonical form. */
  @Column({ type: 'varchar', length: 254 })
  email!: string;

  @Column({ type: 'varchar', length: 40 })
  subject!: ContactSubject;

  @Column({ type: 'varchar', length: 5000 })
  message!: string;

  @Column({ type: 'varchar', length: 16, default: 'new' })
  status!: ContactSubmissionStatus;

  /** HMAC of the client IP, for the per-IP limit only (CF-6). Never on the wire. */
  @Column({ name: 'client_ip_hash', type: 'varchar', length: 64, nullable: true })
  clientIpHash!: string | null;

  /** No default: every insert decides it (`pending` with an attempt, or `failed` without a provider). */
  @Column({ name: 'notification_status', type: 'varchar', length: 16 })
  notificationStatus!: NotificationStatus;

  @Column({ name: 'notification_attempts', type: 'smallint', default: 0 })
  notificationAttempts!: number;

  /** When the latest attempt started; a `pending` row older than the retry window was interrupted (CF-12). */
  @Column({ name: 'notification_attempted_at', type: 'timestamptz', nullable: true })
  notificationAttemptedAt!: Date | null;

  @Column({ name: 'notification_last_error', type: 'varchar', length: 32, nullable: true })
  notificationLastError!: NotificationErrorCategory | null;

  @Column({ name: 'notification_sent_at', type: 'timestamptz', nullable: true })
  notificationSentAt!: Date | null;

  @Column({
    name: 'notification_provider_message_id',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  notificationProviderMessageId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
