import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateContentPosts1792001598048 implements MigrationInterface {
  name = 'CreateContentPosts1792001598048';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "content_posts" ("id" uuid NOT NULL DEFAULT uuidv7(), "author_id" uuid NOT NULL, "language" character varying(16) NOT NULL DEFAULT 'vi', "slug" character varying(160) NOT NULL, "title" character varying(200) NOT NULL, "excerpt" character varying(400), "body" jsonb NOT NULL, "body_version" smallint NOT NULL DEFAULT '1', "status" character varying(16) NOT NULL DEFAULT 'draft', "published_at" TIMESTAMP WITH TIME ZONE, "seo_title" character varying(200), "seo_description" character varying(400), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_content_posts_language_slug" UNIQUE ("language", "slug"), CONSTRAINT "ck_content_posts_published_has_date" CHECK ("status" <> 'published' OR "published_at" IS NOT NULL), CONSTRAINT "ck_content_posts_status" CHECK ("status" IN ('draft', 'published')), CONSTRAINT "ck_content_posts_body_version" CHECK ("body_version" IN (1)), CONSTRAINT "ck_content_posts_body_is_doc" CHECK (jsonb_typeof("body") = 'object' AND "body"->>'type' = 'doc'), CONSTRAINT "ck_content_posts_seo_description_not_blank" CHECK ("seo_description" IS NULL OR btrim("seo_description") <> ''), CONSTRAINT "ck_content_posts_seo_title_not_blank" CHECK ("seo_title" IS NULL OR btrim("seo_title") <> ''), CONSTRAINT "ck_content_posts_excerpt_not_blank" CHECK ("excerpt" IS NULL OR btrim("excerpt") <> ''), CONSTRAINT "ck_content_posts_title_not_blank" CHECK (btrim("title") <> ''), CONSTRAINT "ck_content_posts_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'), CONSTRAINT "ck_content_posts_language" CHECK ("language" IN ('vi')), CONSTRAINT "pk_content_posts" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_content_posts_author_id_updated_at_id" ON "content_posts"  ("author_id", "updated_at", "id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_content_posts_language_status_published_at_id" ON "content_posts"  ("language", "status", "published_at", "id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "content_posts" ADD CONSTRAINT "fk_content_posts_author_id" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "content_posts" DROP CONSTRAINT "fk_content_posts_author_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."ix_content_posts_language_status_published_at_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."ix_content_posts_author_id_updated_at_id"`);
    await queryRunner.query(`DROP TABLE "content_posts"`);
  }
}
