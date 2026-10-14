import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateServices1791710155502 implements MigrationInterface {
  name = 'CreateServices1791710155502';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "services" ("id" uuid NOT NULL DEFAULT uuidv7(), "slug" character varying(80) NOT NULL, "title" character varying(120) NOT NULL, "summary" character varying(500) NOT NULL, "is_published" boolean NOT NULL DEFAULT false, "sort_order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_services_slug" UNIQUE ("slug"), CONSTRAINT "ck_services_summary_not_blank" CHECK (btrim("summary") <> ''), CONSTRAINT "ck_services_title_not_blank" CHECK (btrim("title") <> ''), CONSTRAINT "ck_services_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'), CONSTRAINT "pk_services" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "services"`);
  }
}
