import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, MoreThan, type Repository } from 'typeorm';
import { APP_CONFIG } from '../../config/app-config.module.js';
import type { AppConfig } from '../../config/load-config.js';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { type CourseLabel, CourseSales } from '../courses/course-sales.js';
import { type PublicProfile, UserProfilesReader } from '../users/user-profiles.reader.js';
import type { AdminOrderView, OrderView } from './dto/order.dto.js';
import type { AdminOrdersQuery } from './dto/order-requests.dto.js';
import { CHECKOUT_SETTLE_GRACE_MS, decideCheckout } from './checkout-decision.js';
import { Order } from './order.entity.js';
import { ordersErrors } from './orders.errors.js';
import { buildPaymentUrl, normalizeClientIp } from './vnpay/vnpay-payment-url.js';

/** `vnp_ExpireDate` after checkout (course sales spec §5.5). */
const PAYMENT_WINDOW_MS = 15 * 60 * 1000;
/** Checkout throttle (S11): this many orders per user per window. */
const MAX_ORDERS_PER_WINDOW = 5;
const THROTTLE_WINDOW_MS = 15 * 60 * 1000;

/** A refusal whose response carries `Retry-After`; the controller sets the header. */
export abstract class RetryLaterError extends AppError {
  abstract readonly retryAfterSeconds: number;
}

/** Over the checkout throttle: `429 RATE_LIMITED`. */
export class OrderRateLimitedError extends RetryLaterError {
  constructor(readonly retryAfterSeconds: number) {
    super(baselineErrors.RATE_LIMITED);
  }
}

/** The previous order just expired and may still settle (S16): `409 ORDER_PENDING`. */
export class OrderPendingError extends RetryLaterError {
  constructor(readonly retryAfterSeconds: number) {
    super(ordersErrors.ORDER_PENDING);
  }
}

/** `reused`: an existing pending order came back (200) rather than a new one (201). */
export type Checkout = Readonly<{ view: OrderView; paymentUrl: string; reused: boolean }>;

/** Checkout, the buyer's order view and the admin list (course sales spec §5.4). Orders change state only in the IPN. */
@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly sales: CourseSales,
    private readonly profiles: UserProfilesReader,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Spec §5.4 order: course (404), price (409), ownership (409), then payments configured (503), so a 404 stays a 404
   * while payments are off. Then, serialized per user and course (S16): a live pending order is reused, one that just
   * expired makes the buyer wait (409 ORDER_PENDING), and only otherwise is a new order created, throttled (S11).
   */
  async checkout(
    userId: string,
    courseId: string,
    clientIp: string | undefined,
  ): Promise<Checkout> {
    const course = await this.sales.findForSale(courseId);
    if (!course) throw new AppError(baselineErrors.NOT_FOUND);
    if (course.priceVnd === null) throw new AppError(ordersErrors.COURSE_NOT_FOR_SALE);
    const priceVnd = course.priceVnd;
    if (await this.sales.hasActiveAccess(userId, courseId)) {
      throw new AppError(ordersErrors.COURSE_ALREADY_OWNED);
    }
    const payments = this.config.payments;
    if (payments.provider !== 'vnpay') throw new AppError(ordersErrors.PAYMENTS_UNAVAILABLE);

    // I8: only the transaction's manager inside. The lock makes find-then-insert race-free for parallel clicks.
    const { order, reused } = await this.orders.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `orders:checkout:${userId}:${courseId}`,
      ]);
      const now = Date.now();
      const live = await manager.findOne(Order, {
        where: {
          userId,
          courseId,
          status: 'pending',
          expiresAt: MoreThan(new Date(now - CHECKOUT_SETTLE_GRACE_MS)),
        },
        order: { createdAt: 'DESC', id: 'DESC' },
      });
      const decision = decideCheckout(live, now);
      if (decision.kind === 'wait') throw new OrderPendingError(decision.retryAfterSeconds);
      if (decision.kind === 'reuse') return { order: live as Order, reused: true };
      return { order: await this.create(manager, userId, courseId, priceVnd), reused: false };
    });
    // A reused order is re-signed from its own snapshot (reference, amount, dates): the same VNPAY transaction.
    const paymentUrl = buildPaymentUrl(payments.vnpay, order, normalizeClientIp(clientIp));
    return { view: { order, course }, paymentUrl, reused };
  }

  /** The buyer's own order; someone else's is indistinguishable from an unknown one (404). */
  async getOwn(userId: string, reference: string): Promise<OrderView> {
    const order = await this.orders.findOneBy({ reference, userId });
    if (!order) throw new AppError(baselineErrors.NOT_FOUND);
    const labels = await this.sales.findLabels([order.courseId]);
    // fk_orders_course_id (RESTRICT): the course exists.
    return { order, course: labels.get(order.courseId) as CourseLabel };
  }

  /** Newest first, with one course query and one profile query per page (no N+1). */
  async listForAdmin(
    query: AdminOrdersQuery,
  ): Promise<{ items: AdminOrderView[]; totalItems: number }> {
    const [orders, totalItems] = await this.orders.findAndCount({
      where: query.status ? { status: query.status } : {},
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    const labels = await this.sales.findLabels(orders.map((order) => order.courseId));
    const buyers = new Map(
      (await this.profiles.findPublicProfiles(orders.map((order) => order.userId))).map(
        (profile) => [profile.id, profile],
      ),
    );
    // The FKs (RESTRICT) guarantee both exist.
    const items = orders.map((order) => ({
      order,
      course: labels.get(order.courseId) as CourseLabel,
      buyer: buyers.get(order.userId) as PublicProfile,
    }));
    return { items, totalItems };
  }

  private async create(
    manager: EntityManager,
    userId: string,
    courseId: string,
    amountVnd: number,
  ): Promise<Order> {
    await this.throttle(manager, userId);
    const result = await manager.insert(Order, {
      // Random, so a buyer can't guess another order's URL; hex, because vnp_TxnRef is alphanumeric.
      reference: randomUUID().replaceAll('-', ''),
      userId,
      courseId,
      amountVnd,
      expiresAt: new Date(Date.now() + PAYMENT_WINDOW_MS),
    });
    // Re-read the whole row: insert returns only defaulted columns, and the DTO reads every one.
    return manager.findOneByOrFail(Order, { id: (result.identifiers[0] as { id: string }).id });
  }

  /**
   * S11: at most 5 new orders per user per 15 minutes; `Retry-After` is when the oldest of them leaves the window.
   * Serialized per course only: parallel checkouts of different courses can each pass, which costs nothing.
   */
  private async throttle(manager: EntityManager, userId: string): Promise<void> {
    const recent = await manager.find(Order, {
      select: { createdAt: true },
      where: { userId, createdAt: MoreThan(new Date(Date.now() - THROTTLE_WINDOW_MS)) },
      order: { createdAt: 'ASC' },
      take: MAX_ORDERS_PER_WINDOW,
    });
    if (recent.length < MAX_ORDERS_PER_WINDOW) return;
    const waitMs = recent[0].createdAt.getTime() + THROTTLE_WINDOW_MS - Date.now();
    throw new OrderRateLimitedError(Math.max(1, Math.ceil(waitMs / 1000)));
  }
}
