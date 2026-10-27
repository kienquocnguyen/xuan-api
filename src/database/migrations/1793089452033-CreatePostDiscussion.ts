import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePostDiscussion1793089452033 implements MigrationInterface {
  name = 'CreatePostDiscussion1793089452033';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "content_post_comments" ("id" uuid NOT NULL DEFAULT uuidv7(), "post_id" uuid NOT NULL, "user_id" uuid NOT NULL, "body" character varying(2000) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'visible', "edited_at" TIMESTAMP WITH TIME ZONE, "moderated_by" uuid, "moderated_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ck_content_post_comments_moderation_pair" CHECK (("moderated_by" IS NULL) = ("moderated_at" IS NULL)), CONSTRAINT "ck_content_post_comments_status" CHECK ("status" IN ('visible', 'hidden', 'deleted')), CONSTRAINT "ck_content_post_comments_body_not_blank" CHECK ("body" ~ '[^[:space:]]'), CONSTRAINT "pk_content_post_comments" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_content_post_comments_user_id" ON "content_post_comments"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_content_post_comments_post_id_status_created_at_id" ON "content_post_comments"  ("post_id", "status", "created_at", "id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "content_post_ratings" ("id" uuid NOT NULL DEFAULT uuidv7(), "post_id" uuid NOT NULL, "user_id" uuid NOT NULL, "value" smallint NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'visible', "moderated_by" uuid, "moderated_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_content_post_ratings_post_id_user_id" UNIQUE ("post_id", "user_id"), CONSTRAINT "ck_content_post_ratings_moderation_pair" CHECK (("moderated_by" IS NULL) = ("moderated_at" IS NULL)), CONSTRAINT "ck_content_post_ratings_status" CHECK ("status" IN ('visible', 'hidden')), CONSTRAINT "ck_content_post_ratings_value" CHECK ("value" BETWEEN 1 AND 5), CONSTRAINT "pk_content_post_ratings" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_content_post_ratings_user_id" ON "content_post_ratings"  ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "content_post_comments" ADD CONSTRAINT "fk_content_post_comments_post_id" FOREIGN KEY ("post_id") REFERENCES "content_posts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_post_comments" ADD CONSTRAINT "fk_content_post_comments_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_post_comments" ADD CONSTRAINT "fk_content_post_comments_moderated_by" FOREIGN KEY ("moderated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_post_ratings" ADD CONSTRAINT "fk_content_post_ratings_post_id" FOREIGN KEY ("post_id") REFERENCES "content_posts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_post_ratings" ADD CONSTRAINT "fk_content_post_ratings_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_post_ratings" ADD CONSTRAINT "fk_content_post_ratings_moderated_by" FOREIGN KEY ("moderated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "content_post_ratings" DROP CONSTRAINT "fk_content_post_ratings_moderated_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_post_ratings" DROP CONSTRAINT "fk_content_post_ratings_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_post_ratings" DROP CONSTRAINT "fk_content_post_ratings_post_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_post_comments" DROP CONSTRAINT "fk_content_post_comments_moderated_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_post_comments" DROP CONSTRAINT "fk_content_post_comments_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_post_comments" DROP CONSTRAINT "fk_content_post_comments_post_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."ix_content_post_ratings_user_id"`);
    await queryRunner.query(`DROP TABLE "content_post_ratings"`);
    await queryRunner.query(
      `DROP INDEX "public"."ix_content_post_comments_post_id_status_created_at_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."ix_content_post_comments_user_id"`);
    await queryRunner.query(`DROP TABLE "content_post_comments"`);
  }
}
