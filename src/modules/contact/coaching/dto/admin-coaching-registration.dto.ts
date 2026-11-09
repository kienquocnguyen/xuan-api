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

/** A registration as the admin inbox shows it: never the client IP hash. */
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
  @ApiProperty({ format: 'date-time' }) consentedAt!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

/** Whitelist by construction (I10). */
export function toAdminCoachingRegistrationDto(
  row: CoachingRegistration,
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
    consentedAt: row.consentedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
