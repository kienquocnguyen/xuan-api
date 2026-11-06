import type { DataSource, EntityManager } from 'typeorm';
import type { AppConfig } from '../../config/load-config.js';
import type { CourseSales } from '../courses/course-sales.js';
import type { Order } from './order.entity.js';
import { canonicalQuery, signVnpay } from './vnpay/vnpay-signature.js';
import { VnpayIpnService } from './vnpay-ipn.service.js';

const SECRET = 'test-vnpay-secret';
const REFERENCE = '0123456789abcdef0123456789abcdef';
const vnpay = {
  tmnCode: 'TESTTMN1',
  hashSecret: SECRET,
  paymentUrl: 'https://x',
  returnUrl: 'https://y',
};

/** A query as Express parses it, signed with SECRET unless told otherwise. */
const signedQuery = (overrides: Record<string, string> = {}, secret = SECRET) => {
  const params = {
    vnp_Amount: '49900000',
    vnp_BankCode: 'NCB',
    vnp_CardType: 'ATM',
    vnp_OrderInfo: `Thanh toan khoa hoc ${REFERENCE}`,
    vnp_PayDate: '20261108003500',
    vnp_ResponseCode: '00',
    vnp_TmnCode: 'TESTTMN1',
    vnp_TransactionNo: '14012345',
    vnp_TransactionStatus: '00',
    vnp_TxnRef: REFERENCE,
    ...overrides,
  };
  const query = Object.fromEntries(new URLSearchParams(canonicalQuery(params)));
  return { ...query, vnp_SecureHashType: 'HmacSHA512', vnp_SecureHash: signVnpay(secret, params) };
};

const pendingOrder = (overrides: Partial<Order> = {}): Order =>
  ({
    id: 'order-1',
    reference: REFERENCE,
    userId: 'user-1',
    courseId: 'course-1',
    amountVnd: 499_000,
    status: 'pending',
    ...overrides,
  }) as Order;

/** A DataSource whose transaction runs the work against a recording manager. */
function harness(
  options: { order?: Order | null; payments?: AppConfig['payments']; failUpdate?: boolean } = {},
) {
  const manager = {
    findOne: vi
      .fn()
      .mockResolvedValue(options.order === undefined ? pendingOrder() : options.order),
    update: options.failUpdate
      ? vi.fn().mockRejectedValue(new Error('connection lost'))
      : vi.fn().mockResolvedValue({ affected: 1 }),
  };
  const dataSource = {
    transaction: vi.fn((work: (m: EntityManager) => Promise<unknown>) =>
      work(manager as unknown as EntityManager),
    ),
  };
  const sales = { grantForPurchase: vi.fn().mockResolvedValue(undefined) };
  const config = { payments: options.payments ?? { provider: 'vnpay', vnpay } } as AppConfig;
  const service = new VnpayIpnService(
    dataSource as unknown as DataSource,
    sales as unknown as CourseSales,
    config,
  );
  return { service, manager, dataSource, sales };
}

describe('VnpayIpnService.handle (course sales spec §5.6)', () => {
  it('settles a success: paid with VNPAY’s result, a purchase grant through the same manager, 00', async () => {
    const { service, manager, sales } = harness();
    await expect(service.handle(signedQuery())).resolves.toEqual({
      RspCode: '00',
      Message: 'Confirm Success',
    });
    expect(manager.findOne).toHaveBeenCalledWith(expect.anything(), {
      where: { reference: REFERENCE },
      lock: { mode: 'pessimistic_write' },
    });
    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'order-1' },
      expect.objectContaining({
        status: 'paid',
        paidAt: expect.any(Function),
        vnpTransactionNo: '14012345',
        vnpResponseCode: '00',
        vnpTransactionStatus: '00',
        vnpBankCode: 'NCB',
        vnpCardType: 'ATM',
        vnpBankTranNo: null,
        vnpPayDate: '20261108003500',
      }),
    );
    expect(sales.grantForPurchase).toHaveBeenCalledWith(manager, {
      userId: 'user-1',
      courseId: 'course-1',
      orderId: 'order-1',
    });
  });

  it('records a cancelled payment as failed, grants nothing, and still answers 00 (SIT 2)', async () => {
    const { service, manager, sales } = harness();
    const ack = await service.handle(
      signedQuery({ vnp_ResponseCode: '24', vnp_TransactionStatus: '02' }),
    );
    expect(ack.RspCode).toBe('00');
    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'order-1' },
      expect.objectContaining({ status: 'failed', paidAt: null, vnpResponseCode: '24' }),
    );
    expect(sales.grantForPurchase).not.toHaveBeenCalled();
  });

  it('answers 97 for a signature made with another secret, without opening a transaction (SIT 6)', async () => {
    const { service, dataSource } = harness();
    await expect(service.handle(signedQuery({}, 'another-secret'))).resolves.toEqual({
      RspCode: '97',
      Message: 'Invalid Checksum',
    });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('answers 97 while payments are disabled: there is no secret to verify with', async () => {
    const { service, dataSource } = harness({ payments: { provider: 'disabled' } });
    expect((await service.handle(signedQuery())).RspCode).toBe('97');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('answers 01 for an unknown order (SIT 3), and for a malformed reference without a lookup', async () => {
    const unknown = harness({ order: null });
    expect((await unknown.service.handle(signedQuery())).RspCode).toBe('01');

    const malformed = harness();
    expect((await malformed.service.handle(signedQuery({ vnp_TxnRef: 'ABC' }))).RspCode).toBe('01');
    expect(malformed.manager.findOne).not.toHaveBeenCalled();
  });

  it('answers 04 for a tampered amount and 02 for a settled order, changing nothing (SIT 4, 5)', async () => {
    const tampered = harness();
    expect((await tampered.service.handle(signedQuery({ vnp_Amount: '100' }))).RspCode).toBe('04');
    expect(tampered.manager.update).not.toHaveBeenCalled();

    const replay = harness({ order: pendingOrder({ status: 'paid' }) });
    expect((await replay.service.handle(signedQuery())).RspCode).toBe('02');
    expect(replay.manager.update).not.toHaveBeenCalled();
    expect(replay.sales.grantForPurchase).not.toHaveBeenCalled();
  });

  it('answers 99 when the database fails, so VNPAY retries', async () => {
    const { service, sales } = harness({ failUpdate: true });
    await expect(service.handle(signedQuery())).resolves.toEqual({
      RspCode: '99',
      Message: 'Unknown error',
    });
    expect(sales.grantForPurchase).not.toHaveBeenCalled();
  });

  it('answers 97, never throws, for a repeated key', async () => {
    const { service } = harness();
    const query = { ...signedQuery(), vnp_Amount: ['49900000', '1'] };
    expect((await service.handle(query)).RspCode).toBe('97');
  });

  it('cuts an over-long VNPAY value to its column instead of failing the IPN', async () => {
    const { service, manager } = harness();
    await service.handle(signedQuery({ vnp_BankCode: 'B'.repeat(40) }));
    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ vnpBankCode: 'B'.repeat(20) }),
    );
  });
});
