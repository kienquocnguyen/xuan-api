import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPostLifecycleAndTags1792398583522 implements MigrationInterface {
  name = 'AddPostLifecycleAndTags1792398583522';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Hand-added: TypeORM compares CHECKs by name only, so a widened expression never generates (blog B1 plan, Task 1).
    await queryRunner.query(
      `ALTER TABLE "content_posts" DROP CONSTRAINT "ck_content_posts_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_posts" ADD CONSTRAINT "ck_content_posts_status" CHECK ("status" IN ('draft', 'published', 'archived'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_posts" ADD "tags" character varying(40) array NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_posts" ADD CONSTRAINT "ck_content_posts_tags_count" CHECK (cardinality("tags") <= 10)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "content_posts" DROP CONSTRAINT "ck_content_posts_tags_count"`,
    );
    await queryRunner.query(`ALTER TABLE "content_posts" DROP COLUMN "tags"`);
    // Fails while archived posts exist: roll forward instead (C9, database.md §12).
    await queryRunner.query(
      `ALTER TABLE "content_posts" DROP CONSTRAINT "ck_content_posts_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_posts" ADD CONSTRAINT "ck_content_posts_status" CHECK ("status" IN ('draft', 'published'))`,
    );
  }
}
