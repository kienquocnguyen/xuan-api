import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource, QueryFailedError } from 'typeorm';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const UNKNOWN_ID = '01900000-0000-7000-8000-000000000000';
const REFERENCE = '0123456789abcdef0123456789abcdef';

/** The constraint a failed statement names, or its SQLSTATE when it names none. */
const failureOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof QueryFailedError) {
      const driverError = error.driverError as { constraint?: string; code?: string };
      return driverError.constraint ?? driverError.code;
    }
    throw error;
  }
  throw new Error('expected the statement to fail');
};

describe('orders and purchase grant invariants (course sales spec §5.2–§5.3)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let userId: string;
  let courseId: string;

  // Raw SQL on purpose: these tests probe the database's own constraints, not the entities.
  const insert = (table: string, columns: Record<string, unknown>) => {
    const names = Object.keys(columns);
    const sql = `INSERT INTO ${table} (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`;
    return db.query<{ id: string }[]>(sql, Object.values(columns));
  };
  const insertOrder = (columns: Record<string, unknown> = {}) =>
    insert('orders', {
      reference: REFERENCE,
      user_id: userId,
      course_id: courseId,
      amount_vnd: 499_000,
      expires_at: new Date(Date.now() + 15 * 60_000),
      ...columns,
    });
  const insertPurchaseGrant = (orderId: string, columns: Record<string, unknown> = {}) =>
    insert('course_access_grants', {
      user_id: userId,
      course_id: courseId,
      source: 'purchase',
      order_id: orderId,
      ...columns,
    });

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    [{ id: userId }] = await insert('users', { email: 'hoc@example.vn', display_name: 'Học' });
    [{ id: courseId }] = await insert('courses', {
      slug: 'workflow-edit-video-youtube',
      title: 'Khóa',
      summary: 'Tóm tắt',
      price_vnd: 499_000,
    });
  });
  afterAll(async () => {
    await app.close();
  });

  describe('orders', () => {
    it('fills a uuid v7 id, a pending status and the timestamps', async () => {
      const [{ id }] = await insertOrder();
      const [row] = await db.query<{ id: string; status: string; paid_at: null }[]>(
        `SELECT id, status, paid_at FROM orders WHERE id = $1`,
        [id],
      );
      expect(row).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7/),
        status: 'pending',
        paid_at: null,
      });
    });

    it('fails on uq_orders_reference for a reused reference', async () => {
      await insertOrder();
      expect(await failureOf(insertOrder())).toBe('uq_orders_reference');
    });

    it.each([
      ['ck_orders_reference_format', { reference: REFERENCE.toUpperCase() }],
      ['ck_orders_reference_format', { reference: 'abc' }],
      ['ck_orders_amount_vnd_positive', { amount_vnd: 0 }],
      ['ck_orders_status', { status: 'expired', vnp_response_code: '11' }],
      ['ck_orders_paid_pair', { status: 'paid', vnp_response_code: '00' }],
      ['ck_orders_paid_pair', { paid_at: new Date() }],
      ['ck_orders_settled_has_result', { status: 'failed' }],
      ['fk_orders_user_id', { user_id: UNKNOWN_ID }],
      ['fk_orders_course_id', { course_id: UNKNOWN_ID }],
    ])('fails on %s', async (constraint, columns) => {
      expect(await failureOf(insertOrder(columns))).toBe(constraint);
    });

    it('accepts a paid order with its instant and VNPAY result', async () => {
      await expect(
        insertOrder({ status: 'paid', paid_at: new Date(), vnp_response_code: '00' }),
      ).resolves.toBeDefined();
    });

    it('fails on fk_orders_course_id when an ordered course is deleted', async () => {
      await insertOrder();
      expect(await failureOf(db.query(`DELETE FROM courses WHERE id = $1`, [courseId]))).toBe(
        'fk_orders_course_id',
      );
    });
  });

  describe('purchase grants', () => {
    let orderId: string;
    beforeEach(async () => {
      [{ id: orderId }] = await insertOrder({
        status: 'paid',
        paid_at: new Date(),
        vnp_response_code: '00',
      });
    });

    it('accepts a purchase grant without a granter', async () => {
      await expect(insertPurchaseGrant(orderId)).resolves.toBeDefined();
    });

    it('fails on uq_course_access_grants_order_id_purchase for a second grant of one order', async () => {
      await insertPurchaseGrant(orderId);
      expect(await failureOf(insertPurchaseGrant(orderId))).toBe(
        'uq_course_access_grants_order_id_purchase',
      );
    });

    it('lets a purchase grant coexist with an active admin grant (OD-1, S13)', async () => {
      const [{ id: adminId }] = await insert('users', {
        email: 'admin@example.vn',
        display_name: 'Admin',
        role: 'admin',
      });
      await insert('course_access_grants', {
        user_id: userId,
        course_id: courseId,
        source: 'admin',
        granted_by_user_id: adminId,
      });
      await expect(insertPurchaseGrant(orderId)).resolves.toBeDefined();
    });

    it.each([
      ['ck_course_access_grants_purchase_has_order', { order_id: null }],
      // An admin grant tied to an order (the granter is set, so only this CHECK can fail).
      [
        'ck_course_access_grants_purchase_has_order',
        { source: 'admin', granted_by_user_id: 'self' },
      ],
      ['fk_course_access_grants_order_id', { order_id: UNKNOWN_ID }],
    ])('fails on %s', async (constraint, columns: Record<string, unknown>) => {
      const resolved = Object.fromEntries(
        Object.entries(columns).map(([key, value]) => [key, value === 'self' ? userId : value]),
      );
      expect(await failureOf(insertPurchaseGrant(orderId, resolved))).toBe(constraint);
    });

    it('fails on fk_course_access_grants_order_id when a granted order is deleted', async () => {
      await insertPurchaseGrant(orderId);
      expect(await failureOf(db.query(`DELETE FROM orders WHERE id = $1`, [orderId]))).toBe(
        'fk_course_access_grants_order_id',
      );
    });
  });
});
