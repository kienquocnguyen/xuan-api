import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { APP_CONFIG } from '../../config/app-config.module.js';
import type { AppConfig } from '../../config/load-config.js';
import { CourseSales } from '../courses/course-sales.js';
import { Order } from './order.entity.js';
import { decideIpn, IPN_MESSAGES, type IpnRspCode } from './vnpay/vnpay-ipn-decision.js';
import { verifyVnpay } from './vnpay/vnpay-signature.js';

export type VnpayIpnAck = Readonly<{ RspCode: IpnRspCode; Message: string }>;

const REFERENCE = /^[0-9a-f]{32}$/;
const ack = (code: IpnRspCode): VnpayIpnAck => ({ RspCode: code, Message: IPN_MESSAGES[code] });

/** A VNPAY value for a `varchar(max)` column: absent → null, longer → cut, so storing it can never fail. */
const field = (params: Readonly<Record<string, string>>, key: string, max: number) =>
  params[key] === undefined ? null : params[key].slice(0, max);

/**
 * VNPAY's IPN (course sales spec §5.6, S4): the only writer of an order's outcome and of purchase grants. Trusts
 * nothing but the HMAC and our own amount snapshot. `handle` never throws: every outcome is an `RspCode`, and an
 * unexpected failure rolls back and answers `99`, so VNPAY retries. Logs carry the reference and codes only (I17).
 */
@Injectable()
export class VnpayIpnService {
  private readonly logger = new Logger(VnpayIpnService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly sales: CourseSales,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async handle(query: Readonly<Record<string, unknown>>): Promise<VnpayIpnAck> {
    const payments = this.config.payments;
    // Without a secret nothing can be verified (spec §5.7).
    if (payments.provider !== 'vnpay') return ack('97');
    const verified = verifyVnpay(payments.vnpay.hashSecret, query);
    if (!verified.valid) {
      this.logger.warn('VNPAY IPN refused: invalid checksum');
      return ack('97');
    }
    const params = verified.params;
    const reference = REFERENCE.test(params.vnp_TxnRef ?? '') ? params.vnp_TxnRef : null;
    try {
      const code = await this.dataSource.transaction(async (manager) => {
        // FOR UPDATE: a concurrent duplicate IPN waits here, then sees the settled state and answers 02.
        const order = reference
          ? await manager.findOne(Order, {
              where: { reference },
              lock: { mode: 'pessimistic_write' },
            })
          : null;
        const decision = decideIpn(order, params);
        if (decision.kind === 'ack') return decision.rspCode;
        const settled = order as Order;
        await manager.update(
          Order,
          { id: settled.id },
          {
            status: decision.outcome,
            paidAt: decision.outcome === 'paid' ? () => 'now()' : null,
            vnpTransactionNo: field(params, 'vnp_TransactionNo', 15),
            // Required by VNPAY; if ever absent, its own "other error" code, so the settled order still
            // records a result (ck_orders_settled_has_result) instead of failing the IPN forever.
            vnpResponseCode: field(params, 'vnp_ResponseCode', 2) ?? '99',
            vnpTransactionStatus: field(params, 'vnp_TransactionStatus', 2),
            vnpBankCode: field(params, 'vnp_BankCode', 20),
            vnpCardType: field(params, 'vnp_CardType', 20),
            vnpBankTranNo: field(params, 'vnp_BankTranNo', 255),
            vnpPayDate: field(params, 'vnp_PayDate', 14),
          },
        );
        if (decision.outcome === 'paid') {
          await this.sales.grantForPurchase(manager, {
            userId: settled.userId,
            courseId: settled.courseId,
            orderId: settled.id,
          });
        }
        return '00' as const;
      });
      this.logger.log(
        `VNPAY IPN ${reference ?? '(malformed reference)'}: RspCode ${code}, vnp_ResponseCode ${params.vnp_ResponseCode ?? '-'}, vnp_TransactionStatus ${params.vnp_TransactionStatus ?? '-'}`,
      );
      return ack(code);
    } catch (error) {
      // Rolled back: the order stays as it was and VNPAY retries.
      this.logger.error(
        `VNPAY IPN ${reference ?? '(malformed reference)'} failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return ack('99');
    }
  }
}
