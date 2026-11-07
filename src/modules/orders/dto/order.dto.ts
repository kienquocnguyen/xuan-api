import { ApiProperty } from '@nestjs/swagger';
import type { CourseLabel } from '../../courses/course-sales.js';
import type { PublicProfile } from '../../users/user-profiles.reader.js';
import { type Order, ORDER_STATUSES, type OrderStatus } from '../order.entity.js';

/** An order with the course label it was placed for (any course status: an order outlives an unpublish). */
export type OrderView = Readonly<{ order: Order; course: CourseLabel }>;
export type AdminOrderView = OrderView & Readonly<{ buyer: PublicProfile }>;

export class OrderCourseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'workflow-edit-video-youtube' }) slug!: string;
  @ApiProperty() title!: string;
}

/** The buyer's view of an order (contract identifier, I19; course sales spec §5.4). */
export class OrderDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({
    example: '0190a8c40000700080000000000000a1',
    description: 'Sent to VNPAY as vnp_TxnRef.',
  })
  reference!: string;
  @ApiProperty({ enum: ORDER_STATUSES }) status!: OrderStatus;
  @ApiProperty({ type: 'integer', example: 499000, description: 'Whole VND, as charged.' })
  amountVnd!: number;
  @ApiProperty({ type: OrderCourseDto }) course!: OrderCourseDto;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time', description: 'When VNPAY stops accepting this payment.' })
  expiresAt!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) paidAt!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    example: '24',
    description:
      "VNPAY's vnp_ResponseCode when the payment failed; null otherwise. '00' means VNPAY answered but the transaction didn't complete (vnp_TransactionStatus not 00).",
  })
  failureCode!: string | null;
}

/** Checkout's answer: the new pending order and the signed VNPAY URL to send the browser to. */
export class CheckoutDto {
  @ApiProperty({ type: OrderDto }) order!: OrderDto;
  @ApiProperty({
    example: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_Amount=49900000&…',
  })
  paymentUrl!: string;
}

/** A public profile only: no email, no role (UserProfilesReader, AD14). */
export class OrderUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: String, nullable: true }) avatarUrl!: string | null;
}

/** An order in the admin list, with the buyer and VNPAY's result for reconciliation. */
export class AdminOrderDto extends OrderDto {
  @ApiProperty({ type: OrderUserDto }) user!: OrderUserDto;
  @ApiProperty({ type: String, nullable: true }) vnpTransactionNo!: string | null;
  @ApiProperty({ type: String, nullable: true }) vnpBankCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) vnpCardType!: string | null;
  @ApiProperty({ type: String, nullable: true, example: '20261107153000', description: 'GMT+7.' })
  vnpPayDate!: string | null;
}

/** Whitelist by construction (I10). */
export function toOrderDto({ order, course }: OrderView): OrderDto {
  return {
    id: order.id,
    reference: order.reference,
    status: order.status,
    amountVnd: order.amountVnd,
    course: { id: course.id, slug: course.slug, title: course.title },
    createdAt: order.createdAt.toISOString(),
    expiresAt: order.expiresAt.toISOString(),
    paidAt: order.paidAt === null ? null : order.paidAt.toISOString(),
    failureCode: order.status === 'failed' ? order.vnpResponseCode : null,
  };
}

export function toAdminOrderDto(view: AdminOrderView): AdminOrderDto {
  const { order, buyer } = view;
  const base = toOrderDto(view);
  return {
    id: base.id,
    reference: base.reference,
    status: base.status,
    amountVnd: base.amountVnd,
    course: base.course,
    createdAt: base.createdAt,
    expiresAt: base.expiresAt,
    paidAt: base.paidAt,
    failureCode: base.failureCode,
    user: { id: order.userId, displayName: buyer.displayName, avatarUrl: buyer.avatarUrl },
    vnpTransactionNo: order.vnpTransactionNo,
    vnpBankCode: order.vnpBankCode,
    vnpCardType: order.vnpCardType,
    vnpPayDate: order.vnpPayDate,
  };
}
