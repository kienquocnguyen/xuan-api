import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createOpenApiDocument } from '../src/http/openapi/setup-open-api.js';
import { canonicalQuery, signVnpay } from '../src/modules/orders/vnpay/vnpay-signature.js';
import { signInAs, type TestUser, XHR } from './support/auth.js';
import { createTestApp, TEST_VNPAY } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

/**
 * VNPAY's IPN against the real stack (course sales spec §5.6): the six SIT cases, the purchase grant opening the
 * learner routes, duplicates and two IPNs at once. Queries are signed with the test terminal's secret.
 */
describe('VNPAY IPN (GET /payments/vnpay/ipn)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let buyer: { user: TestUser; cookie: string };
  let lessonId: string;
  let order: { id: string; reference: string };

  const insert = async (table: string, columns: Record<string, unknown>) => {
    const names = Object.keys(columns);
    const [{ id }] = await db.query<{ id: string }[]>(
      `INSERT INTO ${table} (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(columns),
    );
    return id;
  };
  const server = () => request(app.getHttpServer());

  /** The IPN query string VNPAY would send for `order`, signed with `secret`. */
  const ipnPath = (
    overrides: Record<string, string> = {},
    secret: string = TEST_VNPAY.hashSecret,
  ) => {
    const params = {
      vnp_Amount: '49900000',
      vnp_BankCode: 'NCB',
      vnp_BankTranNo: 'VNP14012345',
      vnp_CardType: 'ATM',
      vnp_OrderInfo: `Thanh toan khoa hoc ${order.reference}`,
      vnp_PayDate: '20261108003500',
      vnp_ResponseCode: '00',
      vnp_TmnCode: TEST_VNPAY.tmnCode,
      vnp_TransactionNo: '14012345',
      vnp_TransactionStatus: '00',
      vnp_TxnRef: order.reference,
      ...overrides,
    };
    return `/payments/vnpay/ipn?${canonicalQuery(params)}&vnp_SecureHashType=HmacSHA512&vnp_SecureHash=${signVnpay(secret, params)}`;
  };
  const ipn = (overrides: Record<string, string> = {}, secret?: string) =>
    server().get(ipnPath(overrides, secret));
  const orderRow = async () =>
    (
      await db.query<
        {
          status: string;
          paid_at: Date | null;
          vnp_response_code: string | null;
          vnp_transaction_no: string | null;
        }[]
      >(`SELECT status, paid_at, vnp_response_code, vnp_transaction_no FROM orders WHERE id = $1`, [
        order.id,
      ])
    )[0];
  const purchaseGrants = () =>
    db.query<{ user_id: string; order_id: string }[]>(
      `SELECT user_id, order_id FROM course_access_grants WHERE source = 'purchase'`,
    );

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    buyer = await signInAs(app);
    const courseId = await insert('courses', {
      slug: 'workflow-edit-video-youtube',
      title: 'Khóa',
      summary: 'Tóm tắt',
      status: 'published',
      published_at: '2026-10-01T00:00:00.000Z',
      price_vnd: 499_000,
    });
    const sectionId = await insert('course_sections', {
      course_id: courseId,
      title: 'Phần',
      position: 0,
    });
    lessonId = await insert('course_lessons', {
      section_id: sectionId,
      title: 'Bài 1',
      position: 0,
      status: 'published',
      youtube_video_id: 'dQw4w9WgXcQ',
    });
    const res = await server()
      .post('/orders')
      .set(XHR)
      .set('Cookie', buyer.cookie)
      .send({ courseId });
    order = res.body.data.order;
  });
  afterAll(async () => {
    await app.close();
  });

  it('SIT 1: a success answers 00, marks the order paid and opens the course to the buyer', async () => {
    const learnBefore = await server()
      .get(`/learn/courses/workflow-edit-video-youtube/lessons/${lessonId}`)
      .set('Cookie', buyer.cookie);
    expect(learnBefore.status).toBe(403);

    const res = await ipn();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ RspCode: '00', Message: 'Confirm Success' });
    expect(await orderRow()).toEqual({
      status: 'paid',
      paid_at: expect.any(Date),
      vnp_response_code: '00',
      vnp_transaction_no: '14012345',
    });
    expect(await purchaseGrants()).toEqual([{ user_id: buyer.user.id, order_id: order.id }]);

    const lesson = await server()
      .get(`/learn/courses/workflow-edit-video-youtube/lessons/${lessonId}`)
      .set('Cookie', buyer.cookie);
    expect(lesson.status).toBe(200);
    expect(lesson.body.data.video).toEqual({
      provider: 'youtube',
      videoId: 'dQw4w9WgXcQ',
      privacyHash: null,
    });
    const status = await server().get(`/orders/${order.reference}`).set('Cookie', buyer.cookie);
    expect(status.body.data).toEqual(
      expect.objectContaining({ status: 'paid', paidAt: expect.any(String) }),
    );
  });

  it('SIT 2: a cancelled payment answers 00, records the failure and grants nothing', async () => {
    const res = await ipn({ vnp_ResponseCode: '24', vnp_TransactionStatus: '02' });
    expect(res.body).toEqual({ RspCode: '00', Message: 'Confirm Success' });
    expect(await orderRow()).toEqual(
      expect.objectContaining({ status: 'failed', paid_at: null, vnp_response_code: '24' }),
    );
    expect(await purchaseGrants()).toEqual([]);
    const status = await server().get(`/orders/${order.reference}`).set('Cookie', buyer.cookie);
    expect(status.body.data).toEqual(
      expect.objectContaining({ status: 'failed', failureCode: '24' }),
    );
  });

  it('SIT 3: an unknown order answers 01', async () => {
    expect((await ipn({ vnp_TxnRef: 'f'.repeat(32) })).body).toEqual({
      RspCode: '01',
      Message: 'Order Not Found',
    });
  });

  it('SIT 4: the same success again answers 02 and keeps one grant', async () => {
    await ipn();
    expect((await ipn()).body).toEqual({ RspCode: '02', Message: 'Order already confirmed' });
    expect(await purchaseGrants()).toHaveLength(1);
  });

  it('SIT 5: a tampered amount answers 04 and changes nothing', async () => {
    expect((await ipn({ vnp_Amount: '100' })).body).toEqual({
      RspCode: '04',
      Message: 'Invalid amount',
    });
    expect((await orderRow()).status).toBe('pending');
  });

  it('SIT 6: a signature made with another secret answers 97 and changes nothing', async () => {
    expect((await ipn({}, 'another-secret')).body).toEqual({
      RspCode: '97',
      Message: 'Invalid Checksum',
    });
    expect((await orderRow()).status).toBe('pending');
  });

  it('answers 97, never a 500 or an envelope, for a request without a signature', async () => {
    const res = await server().get('/payments/vnpay/ipn?vnp_TxnRef=abc');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ RspCode: '97', Message: 'Invalid Checksum' });
  });

  it('settles a success after a recorded failure (S14)', async () => {
    await ipn({ vnp_ResponseCode: '24', vnp_TransactionStatus: '02' });
    expect((await ipn()).body.RspCode).toBe('00');
    expect((await orderRow()).status).toBe('paid');
    expect(await purchaseGrants()).toHaveLength(1);
  });

  it('grants once when two success IPNs arrive together: answers 00 and 02', async () => {
    for (let trial = 0; trial < 10; trial += 1) {
      await db.query(`DELETE FROM course_access_grants WHERE order_id = $1`, [order.id]);
      await db.query(
        `UPDATE orders SET status = 'pending', paid_at = NULL, vnp_response_code = NULL WHERE id = $1`,
        [order.id],
      );
      const codes = (await Promise.all([ipn(), ipn()]))
        .map((res) => String(res.body.RspCode))
        .sort((a, b) => a.localeCompare(b));
      expect(codes).toEqual(['00', '02']);
      expect(await purchaseGrants()).toHaveLength(1);
    }
  });

  it('is not part of the OpenAPI document (VNPAY’s contract, not xuan-web’s)', async () => {
    expect(Object.keys(createOpenApiDocument(app).paths)).not.toContain('/payments/vnpay/ipn');
  });
});
