import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPostMedia1792426337024 implements MigrationInterface {
  name = 'AddPostMedia1792426337024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Hand-added: TypeORM compares CHECKs by name only (blog B1 ruling); body version 2 (spec §5.5).
    await queryRunner.query(
      `ALTER TABLE "content_posts" DROP CONSTRAINT "ck_content_posts_body_version"`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_posts" ADD CONSTRAINT "ck_content_posts_body_version" CHECK ("body_version" IN (1, 2))`,
    );
    await queryRunner.query(
      `CREATE TABLE "content_media" ("id" uuid NOT NULL DEFAULT uuidv7(), "uploader_id" uuid NOT NULL, "storage_key" character varying(80) NOT NULL, "content_type" character varying(32) NOT NULL DEFAULT 'image/webp', "width" integer NOT NULL, "height" integer NOT NULL, "variant_widths" smallint array NOT NULL, "byte_size" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_content_media_storage_key" UNIQUE ("storage_key"), CONSTRAINT "ck_content_media_byte_size_positive" CHECK ("byte_size" > 0), CONSTRAINT "ck_content_media_variant_widths_not_empty" CHECK (cardinality("variant_widths") >= 1), CONSTRAINT "ck_content_media_dimensions" CHECK ("width" BETWEEN 1 AND 6000 AND "height" BETWEEN 1 AND 6000), CONSTRAINT "ck_content_media_content_type" CHECK ("content_type" IN ('image/webp')), CONSTRAINT "ck_content_media_storage_key_format" CHECK ("storage_key" ~ '^blog/[0-9a-f-]{36}$'), CONSTRAINT "pk_content_media" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_content_media_uploader_id" ON "content_media"  ("uploader_id") `,
    );
    await queryRunner.query(`ALTER TABLE "content_posts" ADD "cover_media_id" uuid`);
    await queryRunner.query(`ALTER TABLE "content_posts" ADD "cover_alt" character varying(200)`);
    await queryRunner.query(`ALTER TABLE "content_posts" ADD "og_media_id" uuid`);
    await queryRunner.query(
      `CREATE INDEX "ix_content_posts_og_media_id" ON "content_posts"  ("og_media_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_content_posts_cover_media_id" ON "content_posts"  ("cover_media_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "content_posts" ADD CONSTRAINT "ck_content_posts_cover_alt" CHECK (("cover_media_id" IS NULL AND "cover_alt" IS NULL) OR ("cover_media_id" IS NOT NULL AND btrim("cover_alt") <> ''))`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_media" ADD CONSTRAINT "fk_content_media_uploader_id" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_posts" ADD CONSTRAINT "fk_content_posts_cover_media_id" FOREIGN KEY ("cover_media_id") REFERENCES "content_media"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_posts" ADD CONSTRAINT "fk_content_posts_og_media_id" FOREIGN KEY ("og_media_id") REFERENCES "content_media"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "content_posts" DROP CONSTRAINT "fk_content_posts_og_media_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_posts" DROP CONSTRAINT "fk_content_posts_cover_media_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_media" DROP CONSTRAINT "fk_content_media_uploader_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_posts" DROP CONSTRAINT "ck_content_posts_cover_alt"`,
    );
    await queryRunner.query(`DROP INDEX "public"."ix_content_posts_cover_media_id"`);
    await queryRunner.query(`DROP INDEX "public"."ix_content_posts_og_media_id"`);
    await queryRunner.query(`ALTER TABLE "content_posts" DROP COLUMN "og_media_id"`);
    await queryRunner.query(`ALTER TABLE "content_posts" DROP COLUMN "cover_alt"`);
    await queryRunner.query(`ALTER TABLE "content_posts" DROP COLUMN "cover_media_id"`);
    await queryRunner.query(`DROP INDEX "public"."ix_content_media_uploader_id"`);
    await queryRunner.query(`DROP TABLE "content_media"`);
    // Fails while version-2 posts exist: roll forward instead (C9, database.md §12).
    await queryRunner.query(
      `ALTER TABLE "content_posts" DROP CONSTRAINT "ck_content_posts_body_version"`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_posts" ADD CONSTRAINT "ck_content_posts_body_version" CHECK ("body_version" IN (1))`,
    );
  }
}
