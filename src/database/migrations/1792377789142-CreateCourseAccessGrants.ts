import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCourseAccessGrants1792377789142 implements MigrationInterface {
  name = 'CreateCourseAccessGrants1792377789142';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "course_access_grants" ("id" uuid NOT NULL DEFAULT uuidv7(), "user_id" uuid NOT NULL, "course_id" uuid NOT NULL, "source" character varying(16) NOT NULL, "granted_by_user_id" uuid, "granted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "revoked_at" TIMESTAMP WITH TIME ZONE, "revoked_by_user_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ck_course_access_grants_revocation_pair" CHECK (("revoked_at" IS NULL) = ("revoked_by_user_id" IS NULL)), CONSTRAINT "ck_course_access_grants_admin_has_granter" CHECK ("source" <> 'admin' OR "granted_by_user_id" IS NOT NULL), CONSTRAINT "ck_course_access_grants_source" CHECK ("source" IN ('admin')), CONSTRAINT "pk_course_access_grants" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_course_access_grants_user_id_course_id" ON "course_access_grants"  ("user_id", "course_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_course_access_grants_user_id_course_id_active_admin" ON "course_access_grants"  ("user_id", "course_id") WHERE "source" = 'admin' AND "revoked_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_access_grants" ADD CONSTRAINT "fk_course_access_grants_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_access_grants" ADD CONSTRAINT "fk_course_access_grants_course_id" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_access_grants" ADD CONSTRAINT "fk_course_access_grants_granted_by_user_id" FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_access_grants" ADD CONSTRAINT "fk_course_access_grants_revoked_by_user_id" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "course_access_grants" DROP CONSTRAINT "fk_course_access_grants_revoked_by_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_access_grants" DROP CONSTRAINT "fk_course_access_grants_granted_by_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_access_grants" DROP CONSTRAINT "fk_course_access_grants_course_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_access_grants" DROP CONSTRAINT "fk_course_access_grants_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_course_access_grants_user_id_course_id_active_admin"`,
    );
    await queryRunner.query(`DROP INDEX "public"."ix_course_access_grants_user_id_course_id"`);
    await queryRunner.query(`DROP TABLE "course_access_grants"`);
  }
}
