import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { pageQueryFields } from '../../../http/pagination/page.js';
import {
  CONTACT_SUBMISSION_STATUSES,
  type ContactSubmission,
  type ContactSubmissionStatus,
  NOTIFICATION_STATUSES,
  type NotificationStatus,
} from '../contact-submission.entity.js';
import { CONTACT_SUBJECTS, type ContactSubject } from '../contact-subjects.js';
import {
  NOTIFICATION_ERROR_CATEGORIES,
  type NotificationErrorCategory,
} from '../notifications/contact-notifier.js';
import { STALE_ATTEMPT_SECONDS } from '../notifications/contact-notifications.service.js';

export const adminContactSubmissionsQuerySchema = z
  .strictObject({
    status: z.enum(CONTACT_SUBMISSION_STATUSES).optional(),
    ...pageQueryFields,
  })
  .meta({ id: 'AdminContactSubmissionsQuery' });
export type AdminContactSubmissionsQuery = z.infer<typeof adminContactSubmissionsQuerySchema>;

export const contactSubmissionIdParamSchema = z
  .strictObject({ submissionId: z.uuid() })
  .meta({ id: 'ContactSubmissionIdParam' });
export type ContactSubmissionIdParam = z.infer<typeof contactSubmissionIdParamSchema>;

/** The delivery state of the business-inbox email (CF-10). */
export class AdminContactNotificationDto {
  @ApiProperty({ enum: NOTIFICATION_STATUSES }) status!: NotificationStatus;
  /** Attempts made: 1 after the submission, +1 per admin retry; 0 when no provider was configured. */
  @ApiProperty({ example: 1 }) attempts!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastAttemptAt!: string | null;
  /** Why it isn't sent: set when `failed`, cleared once `sent`. */
  @ApiProperty({ type: String, enum: NOTIFICATION_ERROR_CATEGORIES, nullable: true })
  lastError!: NotificationErrorCategory | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) sentAt!: string | null;
  /** Whether POST …/notification/retry would attempt now: `failed`, or `pending` with a stale attempt. */
  @ApiProperty() retryable!: boolean;
}

/** A submission as the admin inbox shows it (CF-14, CF-15): never the client IP hash. */
export class AdminContactSubmissionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Nguyễn Văn A' }) name!: string;
  @ApiProperty({ format: 'email' }) email!: string;
  @ApiProperty({ enum: CONTACT_SUBJECTS }) subject!: ContactSubject;
  @ApiProperty() message!: string;
  @ApiProperty({ enum: CONTACT_SUBMISSION_STATUSES }) status!: ContactSubmissionStatus;
  @ApiProperty({ type: AdminContactNotificationDto }) notification!: AdminContactNotificationDto;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

const iso = (instant: Date | null) => (instant ? instant.toISOString() : null);

/**
 * Same rule as the retry claim (ContactNotificationsService.retry), on the app's clock rather than the database's:
 * near the boundary a retry may claim nothing, and its answer shows the state as it is.
 */
function isRetryable(row: ContactSubmission, now: Date): boolean {
  if (row.notificationStatus === 'failed') return true;
  return (
    row.notificationStatus === 'pending' &&
    row.notificationAttemptedAt !== null &&
    now.getTime() - row.notificationAttemptedAt.getTime() > STALE_ATTEMPT_SECONDS * 1000
  );
}

/** Whitelist by construction (I10). */
export function toAdminContactSubmissionDto(
  row: ContactSubmission,
  now: Date = new Date(),
): AdminContactSubmissionDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    subject: row.subject,
    message: row.message,
    status: row.status,
    notification: {
      status: row.notificationStatus,
      attempts: row.notificationAttempts,
      lastAttemptAt: iso(row.notificationAttemptedAt),
      lastError: row.notificationLastError,
      sentAt: iso(row.notificationSentAt),
      retryable: isRetryable(row, now),
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
