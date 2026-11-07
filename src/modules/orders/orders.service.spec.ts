import type { Repository } from 'typeorm';
import type { AppConfig } from '../../config/load-config.js';
import type { CourseSales } from '../courses/course-sales.js';
import type { UserProfilesReader } from '../users/user-profiles.reader.js';
import type { Order } from './order.entity.js';
import { toOrderDto } from './dto/order.dto.js';
import { OrderPendingError, OrderRateLimitedError, OrdersService } from './orders.service.js';
import { verifyVnpay } from './vnpay/vnpay-signature.js';

const vnpay = {
  tmnCode: 'TESTTMN1',
  hashSecret: 'test-vnpay-secret',
  paymentUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
  returnUrl: 'http://localhost:3000/khoa-hoc/thanh-toan/ket-qua',
};
const course = {
  id: 'course-1',
  slug: 'workflow-edit-video-youtube',
  title: 'Khóa',
  priceVnd: 499_000,
};
const MINUTE = 60_000;

/** A whole pending row, as TypeORM reads it back. */
const pendingRow = (values: Partial<Order> = {}): Order =>
  ({
    id: 'order-1',
    reference: 'a'.repeat(32),
    userId: 'user-1',
    courseId: 'course-1',
    amountVnd: 499_000,
    status: 'pending',
    expiresAt: new Date(Date.now() + 10 * MINUTE),
    paidAt: null,
    vnpTransactionNo: null,
    vnpResponseCode: null,
    vnpTransactionStatus: null,
    vnpBankCode: null,
    vnpCardType: null,
    vnpBankTranNo: null,
    vnpPayDate: null,
    createdAt: new Date(Date.now() - 5 * MINUTE),
    updatedAt: new Date(Date.now() - 5 * MINUTE),
    ...values,
  }) as Order;

function harness(
  options: {
    forSale?: typeof course | { priceVnd: null } | null;
    owned?: boolean;
    live?: Order | null;
    recent?: Date[];
    payments?: AppConfig['payments'];
  } = {},
) {
  // Like TypeORM: insert returns only identifiers; the re-read returns the whole row, nulls included.
  let inserted: Partial<Order> = {};
  const steps: string[] = [];
  const manager = {
    query: vi.fn(async () => {
      steps.push('lock');
      return [];
    }),
    findOne: vi.fn(async () => {
      steps.push('find-live');
      return options.live ?? null;
    }),
    find: vi.fn(async () => {
      steps.push('throttle');
      return (options.recent ?? []).map((createdAt) => ({ createdAt }));
    }),
    insert: vi.fn(async (_entity: unknown, values: Partial<Order>) => {
      steps.push('insert');
      inserted = values;
      return { identifiers: [{ id: 'order-2' }] };
    }),
    findOneByOrFail: vi.fn(async (_entity: unknown, { id }: { id: string }) =>
      pendingRow({ id, createdAt: new Date(), ...inserted }),
    ),
  };
  const orders = {
    manager: { transaction: vi.fn(async (work: (m: typeof manager) => unknown) => work(manager)) },
  };
  const sales = {
    findForSale: vi
      .fn()
      .mockResolvedValue(options.forSale === undefined ? course : options.forSale),
    hasActiveAccess: vi.fn().mockResolvedValue(options.owned ?? false),
  };
  const config = { payments: options.payments ?? { provider: 'vnpay', vnpay } } as AppConfig;
  const service = new OrdersService(
    orders as unknown as Repository<Order>,
    sales as unknown as CourseSales,
    {} as UserProfilesReader,
    config,
  );
  return { service, manager, orders, sales, steps };
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  throw new Error('expected a refusal');
};

describe('OrdersService.checkout (course sales spec §5.4, S16)', () => {
  it('creates a pending order at the price snapshot and a signed payment URL', async () => {
    const { service, manager } = harness();
    const { view, paymentUrl, reused } = await service.checkout(
      'user-1',
      'course-1',
      '::ffff:203.0.113.7',
    );

    expect(reused).toBe(false);
    const saved = manager.insert.mock.calls[0][1];
    expect(saved).toEqual({
      reference: expect.stringMatching(/^[0-9a-f]{32}$/),
      userId: 'user-1',
      courseId: 'course-1',
      amountVnd: 499_000,
      expiresAt: expect.any(Date),
    });
    const window = (saved.expiresAt as Date).getTime() - Date.now();
    expect(window).toBeGreaterThan(14 * MINUTE);
    expect(window).toBeLessThanOrEqual(15 * MINUTE);
    expect(view.course).toBe(course);
    expect(manager.findOneByOrFail).toHaveBeenCalledWith(expect.anything(), { id: 'order-2' });
    // The view maps to the wire without touching an unset column (review C1).
    expect(toOrderDto(view)).toEqual(
      expect.objectContaining({
        id: 'order-2',
        status: 'pending',
        paidAt: null,
        failureCode: null,
      }),
    );

    const params = Object.fromEntries(new URL(paymentUrl).searchParams);
    expect(params).toMatchObject({
      vnp_TxnRef: saved.reference,
      vnp_Amount: '49900000',
      vnp_IpAddr: '203.0.113.7',
    });
    expect(verifyVnpay(vnpay.hashSecret, params).valid).toBe(true);
  });

  it('serializes on a per-user-and-course lock before looking for a live order (S16)', async () => {
    const { service, manager, steps } = harness();
    await service.checkout('user-1', 'course-1', undefined);
    expect(steps).toEqual(['lock', 'find-live', 'throttle', 'insert']);
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      ['orders:checkout:user-1:course-1'],
    );
  });

  it('reuses a live pending order: same reference and price, re-signed, nothing inserted (S16)', async () => {
    const live = pendingRow({ amountVnd: 450_000 });
    const { service, manager, steps } = harness({ live });
    const { view, paymentUrl, reused } = await service.checkout('user-1', 'course-1', undefined);

    expect(reused).toBe(true);
    expect(view.order).toBe(live);
    expect(steps).toEqual(['lock', 'find-live']);
    expect(manager.insert).not.toHaveBeenCalled();
    const params = Object.fromEntries(new URL(paymentUrl).searchParams);
    // The order's own snapshot, even if the price changed since (the buyer saw this amount).
    expect(params).toMatchObject({ vnp_TxnRef: live.reference, vnp_Amount: '45000000' });
    expect(verifyVnpay(vnpay.hashSecret, params).valid).toBe(true);
  });

  it('refuses with ORDER_PENDING and Retry-After while a just-expired order may still settle (S16)', async () => {
    const live = pendingRow({ expiresAt: new Date(Date.now() - 2 * MINUTE) });
    const { service, manager } = harness({ live });
    const refusal = service.checkout('user-1', 'course-1', undefined);
    await expect(refusal).rejects.toBeInstanceOf(OrderPendingError);
    const error = (await refusal.catch((caught: unknown) => caught)) as OrderPendingError;
    expect(error.code).toBe('ORDER_PENDING');
    expect(error.retryAfterSeconds).toBeGreaterThan(2 * 60);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(3 * 60);
    expect(manager.insert).not.toHaveBeenCalled();
  });

  it('looks only at pending orders of this user and course still inside expiry + grace', async () => {
    const { service, manager } = harness();
    await service.checkout('user-1', 'course-1', undefined);
    const [, options] = manager.findOne.mock.calls[0] as unknown as [
      unknown,
      { where: Record<string, unknown>; order: unknown },
    ];
    expect(options.where).toEqual({
      userId: 'user-1',
      courseId: 'course-1',
      status: 'pending',
      expiresAt: expect.objectContaining({ _type: 'moreThan' }),
    });
    const after = (options.where.expiresAt as { _value: Date })._value.getTime();
    expect(Date.now() - after).toBeGreaterThanOrEqual(5 * MINUTE - 1000);
    expect(Date.now() - after).toBeLessThanOrEqual(5 * MINUTE + 1000);
    expect(options.order).toEqual({ createdAt: 'DESC', id: 'DESC' });
  });

  it.each([
    ['an unknown or unpublished course', { forSale: null }, 'NOT_FOUND'],
    ['a course without a price', { forSale: { ...course, priceVnd: null } }, 'COURSE_NOT_FOR_SALE'],
    ['a course the user already has', { owned: true, live: pendingRow() }, 'COURSE_ALREADY_OWNED'],
    [
      'payments switched off',
      { payments: { provider: 'disabled' as const } },
      'PAYMENTS_UNAVAILABLE',
    ],
  ])('refuses %s, writing nothing', async (_case, options, code) => {
    const { service, orders } = harness(options);
    expect(await codeOf(service.checkout('user-1', 'course-1', undefined))).toBe(code);
    expect(orders.manager.transaction).not.toHaveBeenCalled();
  });

  it('checks the course before the payment settings, so a 404 stays a 404 while payments are off', async () => {
    const { service } = harness({ forSale: null, payments: { provider: 'disabled' } });
    expect(await codeOf(service.checkout('user-1', 'course-1', undefined))).toBe('NOT_FOUND');
  });

  it('throttles the sixth new order within 15 minutes, with Retry-After from the oldest (S11)', async () => {
    const oldest = new Date(Date.now() - 10 * MINUTE);
    const recent = [oldest, ...Array.from({ length: 4 }, () => new Date())];
    const { service, manager } = harness({ recent });
    const refusal = service.checkout('user-1', 'course-1', undefined);
    await expect(refusal).rejects.toBeInstanceOf(OrderRateLimitedError);
    const seconds = await refusal.catch((error: OrderRateLimitedError) => error.retryAfterSeconds);
    expect(seconds).toBeGreaterThan(4 * 60);
    expect(seconds).toBeLessThanOrEqual(5 * 60);
    expect(manager.insert).not.toHaveBeenCalled();
  });

  it('never throttles a reuse: it creates nothing (S11, S16)', async () => {
    const recent = Array.from({ length: 5 }, () => new Date());
    const { service } = harness({ recent, live: pendingRow() });
    await expect(service.checkout('user-1', 'course-1', undefined)).resolves.toEqual(
      expect.objectContaining({ reused: true }),
    );
  });

  it('lets a fifth order through', async () => {
    const { service } = harness({ recent: Array.from({ length: 4 }, () => new Date()) });
    await expect(service.checkout('user-1', 'course-1', undefined)).resolves.toBeDefined();
  });
});
