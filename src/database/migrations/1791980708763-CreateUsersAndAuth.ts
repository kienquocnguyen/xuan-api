import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersAndAuth1791980708763 implements MigrationInterface {
  name = 'CreateUsersAndAuth1791980708763';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuidv7(), "email" character varying(320) NOT NULL, "display_name" character varying(200) NOT NULL, "avatar_url" character varying(2048), "role" character varying(16) NOT NULL DEFAULT 'user', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_users_email" UNIQUE ("email"), CONSTRAINT "ck_users_role" CHECK ("role" IN ('user', 'editor', 'admin')), CONSTRAINT "ck_users_display_name_not_blank" CHECK (btrim("display_name") <> ''), CONSTRAINT "ck_users_email_lowercase" CHECK ("email" = lower("email")), CONSTRAINT "pk_users" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "auth_identities" ("id" uuid NOT NULL DEFAULT uuidv7(), "user_id" uuid NOT NULL, "provider" character varying(32) NOT NULL, "provider_user_id" character varying(255) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_auth_identities_user_id_provider" UNIQUE ("user_id", "provider"), CONSTRAINT "uq_auth_identities_provider_provider_user_id" UNIQUE ("provider", "provider_user_id"), CONSTRAINT "ck_auth_identities_provider" CHECK ("provider" IN ('google')), CONSTRAINT "pk_auth_identities" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "sessions" ("id" uuid NOT NULL DEFAULT uuidv7(), "user_id" uuid NOT NULL, "token_hash" character(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_sessions_token_hash" UNIQUE ("token_hash"), CONSTRAINT "pk_sessions" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "ix_sessions_user_id" ON "sessions"  ("user_id") `);
    await queryRunner.query(
      `ALTER TABLE "auth_identities" ADD CONSTRAINT "fk_auth_identities_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD CONSTRAINT "fk_sessions_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sessions" DROP CONSTRAINT "fk_sessions_user_id"`);
    await queryRunner.query(
      `ALTER TABLE "auth_identities" DROP CONSTRAINT "fk_auth_identities_user_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."ix_sessions_user_id"`);
    await queryRunner.query(`DROP TABLE "sessions"`);
    await queryRunner.query(`DROP TABLE "auth_identities"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
