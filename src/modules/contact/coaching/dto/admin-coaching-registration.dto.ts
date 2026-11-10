import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { pageQueryFields } from '../../../../http/pagination/page.js';
import {
  COACHING_PROGRAMS,
  COACHING_REGISTRATION_STATUSES,
  GOALS,
  KICKSTART_CHALLENGES,
  PRACTICE_COMMITMENTS,
  THREE_MONTH_CHALLENGES,
  YOUTUBE_STAGES,
  type Challenge,
  type CoachingProgram,
  type CoachingRegistrationStatus,
  type Goal,
  type PracticeCommitment,
  type YoutubeStage,
} from '../coaching-options.js';
import type { CoachingRegistration } from '../coaching-registration.entity.js';
import { NOTIFICATION_STATUSES, type NotificationStatus } from '../../contact-submission.entity.js';
import {
  NOTIFICATION_ERROR_CATEGORIES,
  type NotificationErrorCategory,
} from '../../notifications/contact-notifier.js';
import { isNotificationRetryable } from '../../notifications/notification-retryable.js';

export const adminCoachingRegistrationsQuerySchema = z
  .strictObject({
    status: z.enum(COACHING_REGISTRATION_STATUSES).optional(),
    program: z.enum(COACHING_PROGRAMS).optional(),
    ...pageQueryFields,
  })
  .meta({ id: 'AdminCoachingRegistrationsQuery' });
export type AdminCoachingRegistrationsQuery = z.infer<typeof adminCoachingRegistrationsQuerySchema>;

export const coachingRegistrationIdParamSchema = z
  .strictObject({ registrationId: z.uuid() })
  .meta({ id: 'CoachingRegistrationIdParam' });
export type CoachingRegistrationIdParam = z.infer<typeof coachingRegistrationIdParamSchema>;

const ALL_CHALLENGES = [...new Set([...KICKSTART_CHALLENGES, ...THREE_MONTH_CHALLENGES])];

/** The delivery state of the business-inbox email (CR-12): the same fields as the contact inbox's. */
export class AdminCoachingNotificationDto {
  @ApiProperty({ enum: NOTIFICATION_STATUSES }) status!: NotificationStatus;
  /** Attempts made: 1 after the registration, +1 per admin retry; 0 when no provider was configured. */
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

/** A registration as the admin inbox shows it: never the client IP hash or the provider's message id. */
export class AdminCoachingRegistrationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: COACHING_PROGRAMS }) program!: CoachingProgram;
  @ApiProperty({ example: 'Nguyễn Văn A' }) name!: string;
  @ApiProperty({ format: 'email' }) email!: string;
  @ApiProperty({ enum: YOUTUBE_STAGES }) youtubeStage!: YoutubeStage;
  @ApiProperty({ type: String, nullable: true }) youtubeChannelUrl!: string | null;
  @ApiProperty() expertise!: string;
  @ApiProperty({ type: String, isArray: true, enum: GOALS }) goals!: Goal[];
  @ApiProperty({ type: String, isArray: true, enum: ALL_CHALLENGES }) challenges!: Challenge[];
  @ApiProperty({ type: String, nullable: true }) challengeOther!: string | null;
  /** 3-month program only. */
  @ApiProperty({ type: String, nullable: true }) desiredOutcome!: string | null;
  @ApiProperty({ type: String, enum: PRACTICE_COMMITMENTS, nullable: true })
  practiceCommitment!: PracticeCommitment | null;
  @ApiProperty({ type: String, nullable: true }) favoriteCreators!: string | null;
  @ApiProperty({ enum: COACHING_REGISTRATION_STATUSES }) status!: CoachingRegistrationStatus;
  @ApiProperty({ type: AdminCoachingNotificationDto }) notification!: AdminCoachingNotificationDto;
  @ApiProperty({ format: 'date-time' }) consentedAt!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

/** Whitelist by construction (I10). */
const iso = (instant: Date | null) => (instant ? instant.toISOString() : null);

export function toAdminCoachingRegistrationDto(
  row: CoachingRegistration,
  now: Date = new Date(),
): AdminCoachingRegistrationDto {
  return {
    id: row.id,
    program: row.program,
    name: row.name,
    email: row.email,
    youtubeStage: row.youtubeStage,
    youtubeChannelUrl: row.youtubeChannelUrl,
    expertise: row.expertise,
    goals: row.goals,
    challenges: row.challenges,
    challengeOther: row.challengeOther,
    desiredOutcome: row.desiredOutcome,
    practiceCommitment: row.practiceCommitment,
    favoriteCreators: row.favoriteCreators,
    status: row.status,
    notification: {
      status: row.notificationStatus,
      attempts: row.notificationAttempts,
      lastAttemptAt: iso(row.notificationAttemptedAt),
      lastError: row.notificationLastError,
      sentAt: iso(row.notificationSentAt),
      retryable: isNotificationRetryable(row, now),
    },
    consentedAt: row.consentedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
