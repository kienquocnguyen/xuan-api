import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  GOALS,
  KICKSTART_CHALLENGES,
  THREE_MONTH_CHALLENGES,
  type Challenge,
  type CoachingProgram,
  type CoachingRegistrationStatus,
  type Goal,
  type PracticeCommitment,
  type YoutubeStage,
} from './coaching-options.js';

const sqlList = (values: readonly string[]) =>
  `ARRAY[${values.map((value) => `'${value}'`).join(', ')}]::varchar[]`;

/**
 * `coaching_registrations` (database.md §12): a registration for 1-1 coaching or the 3-month program, reviewed in
 * the admin page. Never deleted in V1.
 */
@Entity('coaching_registrations')
@Index('ix_coaching_registrations_status_created_at_id', ['status', 'createdAt', 'id'])
@Index('ix_coaching_registrations_email_created_at', ['email', 'createdAt'])
@Index('ix_coaching_registrations_client_ip_hash_created_at', ['clientIpHash', 'createdAt'])
@Check(
  'ck_coaching_registrations_program',
  `"program" IN ('channel_kickstart_session', 'youtube_coaching_3_months')`,
)
@Check('ck_coaching_registrations_name_not_blank', `"name" ~ '[^[:space:]]'`)
@Check('ck_coaching_registrations_email_lowercase', `"email" = lower("email")`)
@Check(
  'ck_coaching_registrations_youtube_stage',
  `"youtube_stage" IN ('not_started', 'has_channel')`,
)
@Check(
  'ck_coaching_registrations_channel_url_stage',
  `"youtube_stage" = 'has_channel' OR "youtube_channel_url" IS NULL`,
)
@Check('ck_coaching_registrations_expertise_not_blank', `"expertise" ~ '[^[:space:]]'`)
@Check(
  'ck_coaching_registrations_goals',
  `cardinality("goals") >= 1 AND "goals" <@ ${sqlList(GOALS)}`,
)
@Check(
  'ck_coaching_registrations_challenges',
  `("program" <> 'channel_kickstart_session' OR "challenges" <@ ${sqlList(KICKSTART_CHALLENGES)}) AND ("program" <> 'youtube_coaching_3_months' OR "challenges" <@ ${sqlList(THREE_MONTH_CHALLENGES)}) AND cardinality("challenges") >= 1`,
)
@Check(
  'ck_coaching_registrations_challenge_other',
  `("challenge_other" IS NULL OR 'other' = ANY("challenges")) AND ("program" <> 'youtube_coaching_3_months' OR NOT ('other' = ANY("challenges")) OR "challenge_other" IS NOT NULL)`,
)
@Check(
  'ck_coaching_registrations_three_month_fields',
  `("program" = 'youtube_coaching_3_months') = ("desired_outcome" IS NOT NULL) AND ("program" = 'youtube_coaching_3_months') = ("practice_commitment" IS NOT NULL)`,
)
@Check(
  'ck_coaching_registrations_practice_commitment',
  `"practice_commitment" IN ('can_commit', 'needs_arranging', 'unsure')`,
)
@Check('ck_coaching_registrations_status', `"status" IN ('new', 'contacted', 'archived')`)
export class CoachingRegistration {
  @PrimaryColumn({
    type: 'uuid',
    default: () => 'uuidv7()',
    primaryKeyConstraintName: 'pk_coaching_registrations',
  })
  id!: string;

  @Column({ type: 'varchar', length: 40 })
  program!: CoachingProgram;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /** Lowercase (D30), so per-email limits and duplicates compare one canonical form. */
  @Column({ type: 'varchar', length: 254 })
  email!: string;

  @Column({ name: 'youtube_stage', type: 'varchar', length: 16 })
  youtubeStage!: YoutubeStage;

  @Column({ name: 'youtube_channel_url', type: 'varchar', length: 500, nullable: true })
  youtubeChannelUrl!: string | null;

  @Column({ type: 'varchar', length: 5000 })
  expertise!: string;

  @Column({ type: 'varchar', length: 40, array: true })
  goals!: Goal[];

  @Column({ type: 'varchar', length: 40, array: true })
  challenges!: Challenge[];

  @Column({ name: 'challenge_other', type: 'varchar', length: 5000, nullable: true })
  challengeOther!: string | null;

  /** 3-month program only (`ck_coaching_registrations_three_month_fields`). */
  @Column({ name: 'desired_outcome', type: 'varchar', length: 5000, nullable: true })
  desiredOutcome!: string | null;

  @Column({ name: 'practice_commitment', type: 'varchar', length: 24, nullable: true })
  practiceCommitment!: PracticeCommitment | null;

  @Column({ name: 'favorite_creators', type: 'varchar', length: 2000, nullable: true })
  favoriteCreators!: string | null;

  /** The server's time of the visitor's consent (CR-9). */
  @Column({ name: 'consented_at', type: 'timestamptz' })
  consentedAt!: Date;

  @Column({ type: 'varchar', length: 16, default: 'new' })
  status!: CoachingRegistrationStatus;

  /** HMAC of the client IP, for the per-IP limit only (CR-7). Never on the wire. */
  @Column({ name: 'client_ip_hash', type: 'varchar', length: 64, nullable: true })
  clientIpHash!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
