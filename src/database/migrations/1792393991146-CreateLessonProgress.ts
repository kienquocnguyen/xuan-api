import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLessonProgress1792393991146 implements MigrationInterface {
  name = 'CreateLessonProgress1792393991146';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "lesson_progress" ("id" uuid NOT NULL DEFAULT uuidv7(), "user_id" uuid NOT NULL, "lesson_id" uuid NOT NULL, "position_seconds" integer NOT NULL, "completed_at" TIMESTAMP WITH TIME ZONE, "last_watched_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_lesson_progress_user_id_lesson_id" UNIQUE ("user_id", "lesson_id"), CONSTRAINT "ck_lesson_progress_position_not_negative" CHECK ("position_seconds" >= 0), CONSTRAINT "pk_lesson_progress" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_lesson_progress_lesson_id" ON "lesson_progress"  ("lesson_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_progress" ADD CONSTRAINT "fk_lesson_progress_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_progress" ADD CONSTRAINT "fk_lesson_progress_lesson_id" FOREIGN KEY ("lesson_id") REFERENCES "course_lessons"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lesson_progress" DROP CONSTRAINT "fk_lesson_progress_lesson_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lesson_progress" DROP CONSTRAINT "fk_lesson_progress_user_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."ix_lesson_progress_lesson_id"`);
    await queryRunner.query(`DROP TABLE "lesson_progress"`);
  }
}
