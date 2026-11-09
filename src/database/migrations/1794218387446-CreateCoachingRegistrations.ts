import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCoachingRegistrations1794218387446 implements MigrationInterface {
  name = 'CreateCoachingRegistrations1794218387446';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "coaching_registrations" ("id" uuid NOT NULL DEFAULT uuidv7(), "program" character varying(40) NOT NULL, "name" character varying(100) NOT NULL, "email" character varying(254) NOT NULL, "youtube_stage" character varying(16) NOT NULL, "youtube_channel_url" character varying(500), "expertise" character varying(5000) NOT NULL, "goals" character varying(40) array NOT NULL, "challenges" character varying(40) array NOT NULL, "challenge_other" character varying(5000), "desired_outcome" character varying(5000), "practice_commitment" character varying(24), "favorite_creators" character varying(2000), "consented_at" TIMESTAMP WITH TIME ZONE NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'new', "client_ip_hash" character varying(64), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ck_coaching_registrations_status" CHECK ("status" IN ('new', 'contacted', 'archived')), CONSTRAINT "ck_coaching_registrations_practice_commitment" CHECK ("practice_commitment" IN ('can_commit', 'needs_arranging', 'unsure')), CONSTRAINT "ck_coaching_registrations_three_month_fields" CHECK (("program" = 'youtube_coaching_3_months') = ("desired_outcome" IS NOT NULL) AND ("program" = 'youtube_coaching_3_months') = ("practice_commitment" IS NOT NULL)), CONSTRAINT "ck_coaching_registrations_challenge_other" CHECK (("challenge_other" IS NULL OR 'other' = ANY("challenges")) AND ("program" <> 'youtube_coaching_3_months' OR NOT ('other' = ANY("challenges")) OR "challenge_other" IS NOT NULL)), CONSTRAINT "ck_coaching_registrations_challenges" CHECK (("program" <> 'channel_kickstart_session' OR "challenges" <@ ARRAY['dont_know_where_to_start', 'too_many_topics', 'unclear_identity', 'cant_turn_knowledge_into_ideas', 'videos_dont_show_value', 'other']::varchar[]) AND ("program" <> 'youtube_coaching_3_months' OR "challenges" <@ ARRAY['unclear_direction', 'too_many_topics', 'cant_turn_knowledge_into_ideas', 'not_confident_on_camera', 'production_difficulty', 'dont_know_how_to_improve', 'hard_to_stay_consistent', 'other']::varchar[]) AND cardinality("challenges") >= 1), CONSTRAINT "ck_coaching_registrations_goals" CHECK (cardinality("goals") >= 1 AND "goals" <@ ARRAY['share_knowledge', 'be_known_for_expertise', 'connect_with_community', 'build_client_trust', 'grow_business', 'still_exploring']::varchar[]), CONSTRAINT "ck_coaching_registrations_expertise_not_blank" CHECK ("expertise" ~ '[^[:space:]]'), CONSTRAINT "ck_coaching_registrations_channel_url_stage" CHECK ("youtube_stage" = 'has_channel' OR "youtube_channel_url" IS NULL), CONSTRAINT "ck_coaching_registrations_youtube_stage" CHECK ("youtube_stage" IN ('not_started', 'has_channel')), CONSTRAINT "ck_coaching_registrations_email_lowercase" CHECK ("email" = lower("email")), CONSTRAINT "ck_coaching_registrations_name_not_blank" CHECK ("name" ~ '[^[:space:]]'), CONSTRAINT "ck_coaching_registrations_program" CHECK ("program" IN ('channel_kickstart_session', 'youtube_coaching_3_months')), CONSTRAINT "pk_coaching_registrations" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_coaching_registrations_client_ip_hash_created_at" ON "coaching_registrations"  ("client_ip_hash", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_coaching_registrations_email_created_at" ON "coaching_registrations"  ("email", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_coaching_registrations_status_created_at_id" ON "coaching_registrations"  ("status", "created_at", "id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."ix_coaching_registrations_status_created_at_id"`);
    await queryRunner.query(`DROP INDEX "public"."ix_coaching_registrations_email_created_at"`);
    await queryRunner.query(
      `DROP INDEX "public"."ix_coaching_registrations_client_ip_hash_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "coaching_registrations"`);
  }
}
