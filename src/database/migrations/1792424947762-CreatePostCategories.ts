import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePostCategories1792424947762 implements MigrationInterface {
  name = 'CreatePostCategories1792424947762';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "content_categories" ("id" uuid NOT NULL DEFAULT uuidv7(), "key" character varying(60) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'active', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_content_categories_key" UNIQUE ("key"), CONSTRAINT "ck_content_categories_status" CHECK ("status" IN ('active', 'archived')), CONSTRAINT "ck_content_categories_key_format" CHECK ("key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'), CONSTRAINT "pk_content_categories" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "content_category_translations" ("id" uuid NOT NULL DEFAULT uuidv7(), "category_id" uuid NOT NULL, "language" character varying(16) NOT NULL DEFAULT 'vi', "slug" character varying(80) NOT NULL, "label" character varying(60) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_content_category_translations_category_id_language" UNIQUE ("category_id", "language"), CONSTRAINT "uq_content_category_translations_language_slug" UNIQUE ("language", "slug"), CONSTRAINT "ck_content_category_translations_label_not_blank" CHECK (btrim("label") <> ''), CONSTRAINT "ck_content_category_translations_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'), CONSTRAINT "ck_content_category_translations_language" CHECK ("language" IN ('vi')), CONSTRAINT "pk_content_category_translations" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`ALTER TABLE "content_posts" ADD "category_id" uuid`);
    await queryRunner.query(
      `CREATE INDEX "ix_content_posts_category_id_status_published_at_id" ON "content_posts"  ("category_id", "status", "published_at", "id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "content_category_translations" ADD CONSTRAINT "fk_content_category_translations_category_id" FOREIGN KEY ("category_id") REFERENCES "content_categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_posts" ADD CONSTRAINT "fk_content_posts_category_id" FOREIGN KEY ("category_id") REFERENCES "content_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "content_posts" DROP CONSTRAINT "fk_content_posts_category_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_category_translations" DROP CONSTRAINT "fk_content_category_translations_category_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."ix_content_posts_category_id_status_published_at_id"`,
    );
    await queryRunner.query(`ALTER TABLE "content_posts" DROP COLUMN "category_id"`);
    await queryRunner.query(`DROP TABLE "content_category_translations"`);
    await queryRunner.query(`DROP TABLE "content_categories"`);
  }
}
