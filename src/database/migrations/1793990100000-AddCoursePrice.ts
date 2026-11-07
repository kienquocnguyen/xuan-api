import { MigrationInterface, QueryRunner } from 'typeorm';

/** Course sales spec §4: a nullable whole-VND price; `null` = not for sale. Additive (spec S15). */
export class AddCoursePrice1793990100000 implements MigrationInterface {
  name = 'AddCoursePrice1793990100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "courses" ADD "price_vnd" integer`);
    await queryRunner.query(
      `ALTER TABLE "courses" ADD CONSTRAINT "ck_courses_price_vnd_range" CHECK ("price_vnd" BETWEEN 1000 AND 100000000)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "courses" DROP CONSTRAINT "ck_courses_price_vnd_range"`);
    await queryRunner.query(`ALTER TABLE "courses" DROP COLUMN "price_vnd"`);
  }
}
