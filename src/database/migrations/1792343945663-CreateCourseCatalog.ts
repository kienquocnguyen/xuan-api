import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCourseCatalog1792343945663 implements MigrationInterface {
  name = 'CreateCourseCatalog1792343945663';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "courses" ("id" uuid NOT NULL DEFAULT uuidv7(), "slug" character varying(160) NOT NULL, "title" character varying(200) NOT NULL, "summary" character varying(500) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'draft', "published_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_courses_slug" UNIQUE ("slug"), CONSTRAINT "ck_courses_published_has_date" CHECK ("status" <> 'published' OR "published_at" IS NOT NULL), CONSTRAINT "ck_courses_status" CHECK ("status" IN ('draft', 'published')), CONSTRAINT "ck_courses_summary_not_blank" CHECK (btrim("summary") <> ''), CONSTRAINT "ck_courses_title_not_blank" CHECK (btrim("title") <> ''), CONSTRAINT "ck_courses_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'), CONSTRAINT "pk_courses" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "course_sections" ("id" uuid NOT NULL DEFAULT uuidv7(), "course_id" uuid NOT NULL, "title" character varying(200) NOT NULL, "position" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_course_sections_course_id_position" UNIQUE ("course_id", "position") DEFERRABLE INITIALLY DEFERRED, CONSTRAINT "ck_course_sections_position_not_negative" CHECK ("position" >= 0), CONSTRAINT "ck_course_sections_title_not_blank" CHECK (btrim("title") <> ''), CONSTRAINT "pk_course_sections" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "course_lessons" ("id" uuid NOT NULL DEFAULT uuidv7(), "section_id" uuid NOT NULL, "title" character varying(200) NOT NULL, "position" integer NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'draft', "vimeo_video_id" character varying(20), "vimeo_hash" character varying(64), "duration_seconds" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_course_lessons_section_id_position" UNIQUE ("section_id", "position") DEFERRABLE INITIALLY DEFERRED, CONSTRAINT "ck_course_lessons_published_has_video" CHECK ("status" <> 'published' OR "vimeo_video_id" IS NOT NULL), CONSTRAINT "ck_course_lessons_duration_positive" CHECK ("duration_seconds" > 0), CONSTRAINT "ck_course_lessons_hash_needs_video" CHECK ("vimeo_hash" IS NULL OR "vimeo_video_id" IS NOT NULL), CONSTRAINT "ck_course_lessons_vimeo_hash_format" CHECK ("vimeo_hash" ~ '^[A-Za-z0-9]{1,64}$'), CONSTRAINT "ck_course_lessons_vimeo_video_id_format" CHECK ("vimeo_video_id" ~ '^[0-9]{1,20}$'), CONSTRAINT "ck_course_lessons_status" CHECK ("status" IN ('draft', 'published')), CONSTRAINT "ck_course_lessons_position_not_negative" CHECK ("position" >= 0), CONSTRAINT "ck_course_lessons_title_not_blank" CHECK (btrim("title") <> ''), CONSTRAINT "pk_course_lessons" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_sections" ADD CONSTRAINT "fk_course_sections_course_id" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_lessons" ADD CONSTRAINT "fk_course_lessons_section_id" FOREIGN KEY ("section_id") REFERENCES "course_sections"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "course_lessons" DROP CONSTRAINT "fk_course_lessons_section_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_sections" DROP CONSTRAINT "fk_course_sections_course_id"`,
    );
    await queryRunner.query(`DROP TABLE "course_lessons"`);
    await queryRunner.query(`DROP TABLE "course_sections"`);
    await queryRunner.query(`DROP TABLE "courses"`);
  }
}
