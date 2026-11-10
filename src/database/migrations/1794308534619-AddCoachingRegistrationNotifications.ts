import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoachingRegistrationNotifications1794308534619 implements MigrationInterface {
  name = 'AddCoachingRegistrationNotifications1794308534619';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Registrations stored before this migration never had an email attempt: they become `failed` with
    // `NOT_CONFIGURED` (0 attempts), which an admin may retry. The temporary default only fills existing rows
    // (C10); it's dropped below, so every later insert still decides the status itself.
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" ADD "notification_status" character varying(16) NOT NULL DEFAULT 'failed'`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" ADD "notification_attempts" smallint NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" ADD "notification_attempted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" ADD "notification_last_error" character varying(32)`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" ADD "notification_sent_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" ADD "notification_provider_message_id" character varying(200)`,
    );
    await queryRunner.query(
      `UPDATE "coaching_registrations" SET "notification_last_error" = 'NOT_CONFIGURED'`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" ALTER COLUMN "notification_status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" ADD CONSTRAINT "ck_coaching_registrations_notification_sent_pair" CHECK (("notification_status" = 'sent') = ("notification_sent_at" IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" ADD CONSTRAINT "ck_coaching_registrations_notification_last_error" CHECK ("notification_last_error" IN ('NOT_CONFIGURED', 'TIMEOUT', 'NETWORK_ERROR', 'PROVIDER_REJECTED', 'PROVIDER_UNAVAILABLE', 'INVALID_RESPONSE'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" ADD CONSTRAINT "ck_coaching_registrations_notification_failed_error" CHECK ("notification_status" <> 'failed' OR "notification_last_error" IS NOT NULL)`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" ADD CONSTRAINT "ck_coaching_registrations_notification_pending_attempt" CHECK ("notification_status" <> 'pending' OR "notification_attempted_at" IS NOT NULL)`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" ADD CONSTRAINT "ck_coaching_registrations_notification_attempts" CHECK ("notification_attempts" >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" ADD CONSTRAINT "ck_coaching_registrations_notification_status" CHECK ("notification_status" IN ('pending', 'sent', 'failed'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" DROP CONSTRAINT "ck_coaching_registrations_notification_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" DROP CONSTRAINT "ck_coaching_registrations_notification_attempts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" DROP CONSTRAINT "ck_coaching_registrations_notification_pending_attempt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" DROP CONSTRAINT "ck_coaching_registrations_notification_failed_error"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" DROP CONSTRAINT "ck_coaching_registrations_notification_last_error"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" DROP CONSTRAINT "ck_coaching_registrations_notification_sent_pair"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" DROP COLUMN "notification_provider_message_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" DROP COLUMN "notification_sent_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" DROP COLUMN "notification_last_error"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" DROP COLUMN "notification_attempted_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" DROP COLUMN "notification_attempts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" DROP COLUMN "notification_status"`,
    );
  }
}
