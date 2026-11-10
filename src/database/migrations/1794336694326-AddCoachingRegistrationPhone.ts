import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoachingRegistrationPhone1794336694326 implements MigrationInterface {
  name = 'AddCoachingRegistrationPhone1794336694326';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" ADD "phone" character varying(16)`,
    );
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" ADD CONSTRAINT "ck_coaching_registrations_phone_format" CHECK ("phone" IS NULL OR ("phone" ~ '^[+][1-9][0-9]{7,14}$' AND ("phone" NOT LIKE '+84%' OR "phone" ~ '^[+]84[0-9]{9}$')))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coaching_registrations" DROP CONSTRAINT "ck_coaching_registrations_phone_format"`,
    );
    await queryRunner.query(`ALTER TABLE "coaching_registrations" DROP COLUMN "phone"`);
  }
}
