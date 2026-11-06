import type { Repository } from 'typeorm';
import type { AppConfig } from '../../config/load-config.js';
import type { CourseSales } from '../courses/course-sales.js';
import type { UserProfilesReader } from '../users/user-profiles.reader.js';
import type { Order } from './order.entity.js';
import { OrderRateLimitedError, OrdersService } from './orders.service.js';
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

function harness(
  options: {
    forSale?: typeof course | { priceVnd: null } | null;
    owned?: boolean;
    recent?: Date[];
    payments?: AppConfig['payments'];
  } = {},
) {
  const orders = {
    find: vi.fn().mockResolvedValue((options.recent ?? []).map((createdAt) => ({ createdAt }))),
    create: vi.fn((values: Partial<Order>) => values),
    save: vi.fn(async (values: Partial<Order>) => ({
      ...values,
      id: 'order-1',
      status: 'pending',
      createdAt: new Date('2026-11-07T17:30:00.000Z'),
    })),
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
  return { service, orders, sales };
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  throw new Error('expected a refusal');
};

describe('OrdersService.checkout (course sales spec §5.4)', () => {
  it('creates a pending order at the price snapshot and a signed payment URL', async () => {
    const { service, orders } = harness();
    const { view, paymentUrl } = await service.checkout('user-1', 'course-1', '::ffff:203.0.113.7');

    const saved = orders.save.mock.calls[0][0] as Partial<Order>;
    expect(saved).toEqual({
      reference: expect.stringMatching(/^[0-9a-f]{32}$/),
      userId: 'user-1',
      courseId: 'course-1',
      amountVnd: 499_000,
      expiresAt: expect.any(Date),
    });
    const window = (saved.expiresAt as Date).getTime() - Date.now();
    expect(window).toBeGreaterThan(14 * 60_000);
    expect(window).toBeLessThanOrEqual(15 * 60_000);
    expect(view.course).toBe(course);

    const params = Object.fromEntries(new URL(paymentUrl).searchParams);
    expect(params).toMatchObject({
      vnp_TxnRef: saved.reference,
      vnp_Amount: '49900000',
      vnp_IpAddr: '203.0.113.7',
    });
    expect(verifyVnpay(vnpay.hashSecret, params).valid).toBe(true);
  });

  it('uses a fresh reference for every checkout (S10)', async () => {
    const { service, orders } = harness();
    await service.checkout('user-1', 'course-1', undefined);
    await service.checkout('user-1', 'course-1', undefined);
    const [first, second] = orders.save.mock.calls.map(([order]) => (order as Order).reference);
    expect(first).not.toBe(second);
  });

  it.each([
    ['an unknown or unpublished course', { forSale: null }, 'NOT_FOUND'],
    ['a course without a price', { forSale: { ...course, priceVnd: null } }, 'COURSE_NOT_FOR_SALE'],
    ['a course the user already has', { owned: true }, 'COURSE_ALREADY_OWNED'],
    [
      'payments switched off',
      { payments: { provider: 'disabled' as const } },
      'PAYMENTS_UNAVAILABLE',
    ],
  ])('refuses %s, writing nothing', async (_case, options, code) => {
    const { service, orders } = harness(options);
    expect(await codeOf(service.checkout('user-1', 'course-1', undefined))).toBe(code);
    expect(orders.save).not.toHaveBeenCalled();
  });

  it('checks the course before the payment settings, so a 404 stays a 404 while payments are off', async () => {
    const { service } = harness({ forSale: null, payments: { provider: 'disabled' } });
    expect(await codeOf(service.checkout('user-1', 'course-1', undefined))).toBe('NOT_FOUND');
  });

  it('throttles the sixth order within 15 minutes, with Retry-After from the oldest (S11)', async () => {
    const oldest = new Date(Date.now() - 10 * 60_000);
    const recent = [oldest, ...Array.from({ length: 4 }, () => new Date())];
    const { service, sales } = harness({ recent });
    const refusal = service.checkout('user-1', 'course-1', undefined);
    await expect(refusal).rejects.toBeInstanceOf(OrderRateLimitedError);
    const seconds = await refusal.catch((error: OrderRateLimitedError) => error.retryAfterSeconds);
    expect(seconds).toBeGreaterThan(4 * 60);
    expect(seconds).toBeLessThanOrEqual(5 * 60);
    expect(sales.findForSale).not.toHaveBeenCalled();
  });

  it('lets a fifth order through', async () => {
    const { service } = harness({ recent: Array.from({ length: 4 }, () => new Date()) });
    await expect(service.checkout('user-1', 'course-1', undefined)).resolves.toBeDefined();
  });
});
