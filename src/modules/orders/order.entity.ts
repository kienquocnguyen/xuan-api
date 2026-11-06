import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/** `failed` isn't terminal for a success (course sales spec S14); there is no `expired` state (S9). */
export const ORDER_STATUSES = ['pending', 'paid', 'failed'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * `orders` (database.md §12; course sales spec §5.2): one checkout of one course by one user, at a price snapshot.
 * Only the IPN settles it. The user and course FKs are declared by entity name, so this module never imports their
 * entities (AD14, I2). `vnp_*` columns hold what VNPAY's IPN said, for support and reconciliation.
 */
@Entity('orders')
@Unique('uq_orders_reference', ['reference'])
@Index('ix_orders_user_id_created_at', ['userId', 'createdAt'])
@Index('ix_orders_course_id', ['courseId'])
@Index('ix_orders_created_at_id', ['createdAt', 'id'])
@Check('ck_orders_reference_format', `"reference" ~ '^[0-9a-f]{32}$'`)
@Check('ck_orders_amount_vnd_positive', `"amount_vnd" > 0`)
@Check('ck_orders_status', `"status" IN ('pending', 'paid', 'failed')`)
@Check('ck_orders_paid_pair', `("status" = 'paid') = ("paid_at" IS NOT NULL)`)
@Check('ck_orders_settled_has_result', `"status" = 'pending' OR "vnp_response_code" IS NOT NULL`)
export class Order {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()', primaryKeyConstraintName: 'pk_orders' })
  id!: string;

  /** Sent as `vnp_TxnRef` (alphanumeric only) and used in the buyer's URL: random, so unguessable. */
  @Column({ type: 'varchar', length: 32 })
  reference!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @ForeignKey('User', { name: 'fk_orders_user_id', onDelete: 'RESTRICT' })
  userId!: string;

  @Column({ name: 'course_id', type: 'uuid' })
  @ForeignKey('Course', { name: 'fk_orders_course_id', onDelete: 'RESTRICT' })
  courseId!: string;

  /** The course price at checkout; the IPN's amount must match it (×100). */
  @Column({ name: 'amount_vnd', type: 'integer' })
  amountVnd!: number;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: OrderStatus;

  /** `vnp_ExpireDate`; display only (S9). */
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @Column({ name: 'vnp_transaction_no', type: 'varchar', length: 15, nullable: true })
  vnpTransactionNo!: string | null;

  @Column({ name: 'vnp_response_code', type: 'varchar', length: 2, nullable: true })
  vnpResponseCode!: string | null;

  @Column({ name: 'vnp_transaction_status', type: 'varchar', length: 2, nullable: true })
  vnpTransactionStatus!: string | null;

  @Column({ name: 'vnp_bank_code', type: 'varchar', length: 20, nullable: true })
  vnpBankCode!: string | null;

  @Column({ name: 'vnp_card_type', type: 'varchar', length: 20, nullable: true })
  vnpCardType!: string | null;

  @Column({ name: 'vnp_bank_tran_no', type: 'varchar', length: 255, nullable: true })
  vnpBankTranNo!: string | null;

  /** Raw `yyyyMMddHHmmss` GMT+7, as VNPAY sent it. */
  @Column({ name: 'vnp_pay_date', type: 'varchar', length: 14, nullable: true })
  vnpPayDate!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
