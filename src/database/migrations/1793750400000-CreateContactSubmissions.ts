import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateContactSubmissions1793750400000 implements MigrationInterface {
  name = 'CreateContactSubmissions1793750400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "contact_submissions" ("id" uuid NOT NULL DEFAULT uuidv7(), "name" character varying(100) NOT NULL, "email" character varying(254) NOT NULL, "subject" character varying(40) NOT NULL, "message" character varying(5000) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'new', "client_ip_hash" character varying(64), "notification_status" character varying(16) NOT NULL, "notification_attempts" smallint NOT NULL DEFAULT '0', "notification_attempted_at" TIMESTAMP WITH TIME ZONE, "notification_last_error" character varying(32), "notification_sent_at" TIMESTAMP WITH TIME ZONE, "notification_provider_message_id" character varying(200), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ck_contact_submissions_notification_sent_pair" CHECK (("notification_status" = 'sent') = ("notification_sent_at" IS NOT NULL)), CONSTRAINT "ck_contact_submissions_notification_last_error" CHECK ("notification_last_error" IN ('NOT_CONFIGURED', 'TIMEOUT', 'NETWORK_ERROR', 'PROVIDER_REJECTED', 'PROVIDER_UNAVAILABLE', 'INVALID_RESPONSE')), CONSTRAINT "ck_contact_submissions_notification_failed_error" CHECK ("notification_status" <> 'failed' OR "notification_last_error" IS NOT NULL), CONSTRAINT "ck_contact_submissions_notification_pending_attempt" CHECK ("notification_status" <> 'pending' OR "notification_attempted_at" IS NOT NULL), CONSTRAINT "ck_contact_submissions_notification_attempts" CHECK ("notification_attempts" >= 0), CONSTRAINT "ck_contact_submissions_notification_status" CHECK ("notification_status" IN ('pending', 'sent', 'failed')), CONSTRAINT "ck_contact_submissions_status" CHECK ("status" IN ('new', 'read', 'archived')), CONSTRAINT "ck_contact_submissions_message_not_blank" CHECK ("message" ~ '[^[:space:]]'), CONSTRAINT "ck_contact_submissions_subject" CHECK ("subject" IN ('youtube_editing_course', 'channel_kickstart_session', 'youtube_coaching_3_months', 'general')), CONSTRAINT "ck_contact_submissions_email_lowercase" CHECK ("email" = lower("email")), CONSTRAINT "ck_contact_submissions_name_not_blank" CHECK ("name" ~ '[^[:space:]]'), CONSTRAINT "pk_contact_submissions" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_contact_submissions_client_ip_hash_created_at" ON "contact_submissions"  ("client_ip_hash", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_contact_submissions_email_created_at" ON "contact_submissions"  ("email", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_contact_submissions_status_created_at_id" ON "contact_submissions"  ("status", "created_at", "id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."ix_contact_submissions_status_created_at_id"`);
    await queryRunner.query(`DROP INDEX "public"."ix_contact_submissions_email_created_at"`);
    await queryRunner.query(
      `DROP INDEX "public"."ix_contact_submissions_client_ip_hash_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "contact_submissions"`);
  }
}
