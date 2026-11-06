import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Course sales spec §3 (S2): a lesson's video may be a YouTube-unlisted id. Hand-written in the generated style
 * (spec S15); the published-has-video CHECK is replaced, relaxed, so no existing row can violate it. `down` fails
 * loudly while a published lesson has only a YouTube video, rather than deleting or unpublishing anything.
 */
export class AddLessonYouTubeVideo1793990000000 implements MigrationInterface {
  name = 'AddLessonYouTubeVideo1793990000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "course_lessons" DROP CONSTRAINT "ck_course_lessons_published_has_video"`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_lessons" ADD "youtube_video_id" character varying(11)`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_lessons" ADD CONSTRAINT "ck_course_lessons_published_has_video" CHECK ("status" <> 'published' OR "vimeo_video_id" IS NOT NULL OR "youtube_video_id" IS NOT NULL)`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_lessons" ADD CONSTRAINT "ck_course_lessons_one_video" CHECK ("vimeo_video_id" IS NULL OR "youtube_video_id" IS NULL)`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_lessons" ADD CONSTRAINT "ck_course_lessons_youtube_video_id_format" CHECK ("youtube_video_id" ~ '^[A-Za-z0-9_-]{11}$')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "course_lessons" DROP CONSTRAINT "ck_course_lessons_youtube_video_id_format"`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_lessons" DROP CONSTRAINT "ck_course_lessons_one_video"`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_lessons" DROP CONSTRAINT "ck_course_lessons_published_has_video"`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_lessons" ADD CONSTRAINT "ck_course_lessons_published_has_video" CHECK ("status" <> 'published' OR "vimeo_video_id" IS NOT NULL)`,
    );
    await queryRunner.query(`ALTER TABLE "course_lessons" DROP COLUMN "youtube_video_id"`);
  }
}
