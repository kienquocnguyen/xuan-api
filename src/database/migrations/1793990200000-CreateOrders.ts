import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Course sales spec §5.2–§5.3: the `orders` table, and purchase grants on `course_access_grants` (expand-only, as
 * course spec §5.4 planned). Hand-written in the generated style (S15). The partial unique index's predicate is
 * written by hand because generate ignores predicates (spike S8). The source CHECK is replaced, widened, so no
 * existing row can violate it; `down` refuses (CHECK violation) while a purchase grant exists, never deleting one.
 */
export class CreateOrders1793990200000 implements MigrationInterface {
  name = 'CreateOrders1793990200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT uuidv7(), "reference" character varying(32) NOT NULL, "user_id" uuid NOT NULL, "course_id" uuid NOT NULL, "amount_vnd" integer NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "paid_at" TIMESTAMP WITH TIME ZONE, "vnp_transaction_no" character varying(15), "vnp_response_code" character varying(2), "vnp_transaction_status" character varying(2), "vnp_bank_code" character varying(20), "vnp_card_type" character varying(20), "vnp_bank_tran_no" character varying(255), "vnp_pay_date" character varying(14), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_orders_reference" UNIQUE ("reference"), CONSTRAINT "ck_orders_settled_has_result" CHECK ("status" = 'pending' OR "vnp_response_code" IS NOT NULL), CONSTRAINT "ck_orders_paid_pair" CHECK (("status" = 'paid') = ("paid_at" IS NOT NULL)), CONSTRAINT "ck_orders_status" CHECK ("status" IN ('pending', 'paid', 'failed')), CONSTRAINT "ck_orders_amount_vnd_positive" CHECK ("amount_vnd" > 0), CONSTRAINT "ck_orders_reference_format" CHECK ("reference" ~ '^[0-9a-f]{32}$'), CONSTRAINT "pk_orders" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_orders_created_at_id" ON "orders"  ("created_at", "id") `,
    );
    await queryRunner.query(`CREATE INDEX "ix_orders_course_id" ON "orders"  ("course_id") `);
    await queryRunner.query(
      `CREATE INDEX "ix_orders_user_id_created_at" ON "orders"  ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "fk_orders_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "fk_orders_course_id" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "course_access_grants" DROP CONSTRAINT "ck_course_access_grants_source"`,
    );
    await queryRunner.query(`ALTER TABLE "course_access_grants" ADD "order_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "course_access_grants" ADD CONSTRAINT "ck_course_access_grants_purchase_has_order" CHECK (("source" = 'purchase') = ("order_id" IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_access_grants" ADD CONSTRAINT "ck_course_access_grants_source" CHECK ("source" IN ('admin', 'purchase'))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_course_access_grants_order_id_purchase" ON "course_access_grants"  ("order_id") WHERE "source" = 'purchase'`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_access_grants" ADD CONSTRAINT "fk_course_access_grants_order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "course_access_grants" DROP CONSTRAINT "fk_course_access_grants_order_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_course_access_grants_order_id_purchase"`);
    await queryRunner.query(
      `ALTER TABLE "course_access_grants" DROP CONSTRAINT "ck_course_access_grants_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_access_grants" DROP CONSTRAINT "ck_course_access_grants_purchase_has_order"`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_access_grants" ADD CONSTRAINT "ck_course_access_grants_source" CHECK ("source" IN ('admin'))`,
    );
    await queryRunner.query(`ALTER TABLE "course_access_grants" DROP COLUMN "order_id"`);

    await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "fk_orders_course_id"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "fk_orders_user_id"`);
    await queryRunner.query(`DROP INDEX "public"."ix_orders_user_id_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."ix_orders_course_id"`);
    await queryRunner.query(`DROP INDEX "public"."ix_orders_created_at_id"`);
    await queryRunner.query(`DROP TABLE "orders"`);
  }
}
