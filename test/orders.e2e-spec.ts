import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { verifyVnpay } from '../src/modules/orders/vnpay/vnpay-signature.js';
import { signInAs, type TestUser, XHR } from './support/auth.js';
import { createTestApp, TEST_VNPAY } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REFERENCE = /^[0-9a-f]{32}$/;
const UNKNOWN_ID = '01900000-0000-7000-8000-000000000000';

const envelope = (code: string, message: string, details: object = {}) => ({
  data: null,
  error: { code, message, details },
});

/** Course sales spec §5.4: checkout, the buyer's order and the admin list. */
describe('Orders (/orders, /admin/orders)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let buyer: { user: TestUser; cookie: string };
  let courseId: string;

  const insert = async (table: string, columns: Record<string, unknown>) => {
    const names = Object.keys(columns);
    const [{ id }] = await db.query<{ id: string }[]>(
      `INSERT INTO ${table} (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(columns),
    );
    return id;
  };
  /** A published course with one published YouTube lesson, at 499.000đ unless told otherwise. */
  const insertCourse = async (columns: Record<string, unknown> = {}) => {
    const id = await insert('courses', {
      slug: 'workflow-edit-video-youtube',
      title: 'Workflow edit video YouTube',
      summary: 'Tóm tắt',
      status: 'published',
      published_at: '2026-10-01T00:00:00.000Z',
      price_vnd: 499_000,
      ...columns,
    });
    const sectionId = await insert('course_sections', {
      course_id: id,
      title: 'Phần 1',
      position: 0,
    });
    await insert('course_lessons', {
      section_id: sectionId,
      title: 'Bài 1',
      position: 0,
      status: 'published',
      youtube_video_id: 'dQw4w9WgXcQ',
    });
    return id;
  };
  const server = () => request(app.getHttpServer());
  /** What a cancelled-payment IPN leaves behind (vnpay-ipn.e2e-spec proves the IPN itself). */
  const fail = (reference: string) =>
    db.query(`UPDATE orders SET status = 'failed', vnp_response_code = '24' WHERE reference = $1`, [
      reference,
    ]);
  const moveExpiry = (reference: string, interval: string) =>
    db.query(`UPDATE orders SET expires_at = now() + $2::interval WHERE reference = $1`, [
      reference,
      interval,
    ]);
  const orderCount = async () =>
    Number((await db.query<{ n: string }[]>(`SELECT count(*) AS n FROM orders`))[0].n);
  const urlParams = (paymentUrl: string) =>
    Object.fromEntries(new URL(paymentUrl).searchParams) as Record<string, string>;
  const checkout = (body: object, cookie = buyer.cookie) =>
    server().post('/orders').set(XHR).set('Cookie', cookie).send(body);

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    buyer = await signInAs(app, { displayName: 'Học viên' });
    courseId = await insertCourse();
  });
  afterAll(async () => {
    await app.close();
  });

  describe('POST /orders', () => {
    it('creates a pending order at the course price and a signed VNPAY URL (201)', async () => {
      const res = await checkout({ courseId });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        data: {
          order: {
            id: expect.stringMatching(UUID),
            reference: expect.stringMatching(REFERENCE),
            status: 'pending',
            amountVnd: 499_000,
            course: {
              id: courseId,
              slug: 'workflow-edit-video-youtube',
              title: 'Workflow edit video YouTube',
            },
            createdAt: expect.stringMatching(ISO),
            expiresAt: expect.stringMatching(ISO),
            paidAt: null,
            failureCode: null,
          },
          paymentUrl: expect.stringMatching(
            /^https:\/\/sandbox\.vnpayment\.vn\/paymentv2\/vpcpay\.html\?/,
          ),
        },
      });
      const params = Object.fromEntries(new URL(res.body.data.paymentUrl).searchParams);
      expect(params).toMatchObject({
        vnp_TmnCode: TEST_VNPAY.tmnCode,
        vnp_TxnRef: res.body.data.order.reference,
        vnp_Amount: '49900000',
        vnp_ReturnUrl: TEST_VNPAY.returnUrl,
      });
      expect(verifyVnpay(TEST_VNPAY.hashSecret, params).valid).toBe(true);
      const [row] = await db.query<{ user_id: string; amount_vnd: number }[]>(
        `SELECT user_id, amount_vnd FROM orders WHERE id = $1`,
        [res.body.data.order.id],
      );
      expect(row).toEqual({ user_id: buyer.user.id, amount_vnd: 499_000 });
    });

    it('needs a session (401) and the CSRF header (403)', async () => {
      expect((await server().post('/orders').set(XHR).send({ courseId })).status).toBe(401);
      const noHeader = await server()
        .post('/orders')
        .set('Cookie', buyer.cookie)
        .send({ courseId });
      expect(noHeader.status).toBe(403);
    });

    it.each([
      ['an unknown course', () => ({ courseId: UNKNOWN_ID })],
      [
        'a draft course',
        async () => ({
          courseId: await insertCourse({ slug: 'nhap', status: 'draft', published_at: null }),
        }),
      ],
    ])('answers 404 for %s', async (_case, body) => {
      const res = await checkout(await body());
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('answers 409 COURSE_NOT_FOR_SALE without a price', async () => {
      await db.query(`UPDATE courses SET price_vnd = NULL WHERE id = $1`, [courseId]);
      expect((await checkout({ courseId })).body).toEqual(
        envelope('COURSE_NOT_FOR_SALE', "This course isn't open for purchase."),
      );
    });

    it('answers 409 COURSE_ALREADY_OWNED with an active grant', async () => {
      const admin = await signInAs(app, { role: 'admin' });
      await insert('course_access_grants', {
        user_id: buyer.user.id,
        course_id: courseId,
        source: 'admin',
        granted_by_user_id: admin.user.id,
      });
      expect((await checkout({ courseId })).body).toEqual(
        envelope('COURSE_ALREADY_OWNED', 'You already have access to this course.'),
      );
    });

    it('answers 400 for a malformed course id', async () => {
      const res = await checkout({ courseId: 'nope' });
      expect(res.status).toBe(400);
      expect(res.body.error.details.fields).toEqual([
        { field: 'courseId', message: expect.any(String), code: 'INVALID_FORMAT' },
      ]);
    });

    it('throttles the sixth new order within 15 minutes with Retry-After (429)', async () => {
      // Each cancelled order frees the course for a new one (S16); the throttle still counts them (S11).
      for (let i = 0; i < 5; i += 1) {
        const res = await checkout({ courseId });
        expect(res.status).toBe(201);
        await fail(res.body.data.order.reference);
      }
      const res = await checkout({ courseId });
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('answers 503 PAYMENTS_UNAVAILABLE while VNPAY is not configured', async () => {
      const off = await createTestApp([], { payments: { provider: 'disabled' } });
      try {
        const res = await request(off.getHttpServer())
          .post('/orders')
          .set(XHR)
          .set('Cookie', buyer.cookie)
          .send({ courseId });
        expect(res.body).toEqual(
          envelope('PAYMENTS_UNAVAILABLE', 'Online payment is temporarily unavailable.'),
        );
        expect(res.status).toBe(503);
      } finally {
        await off.close();
      }
    });
  });

  describe('POST /orders: one payable order per user and course (S16)', () => {
    it('a double click returns the same pending order (200), re-signed for the same VNPAY transaction', async () => {
      const first = await checkout({ courseId });
      const again = await checkout({ courseId });
      expect(first.status).toBe(201);
      expect(again.status).toBe(200);
      expect(again.body.data.order).toEqual(first.body.data.order);
      const before = urlParams(first.body.data.paymentUrl);
      const after = urlParams(again.body.data.paymentUrl);
      for (const key of ['vnp_TxnRef', 'vnp_Amount', 'vnp_CreateDate', 'vnp_ExpireDate']) {
        expect(after[key]).toBe(before[key]);
      }
      expect(verifyVnpay(TEST_VNPAY.hashSecret, after).valid).toBe(true);
      expect(await orderCount()).toBe(1);
    });

    it('concurrent checkouts create exactly one order; the others reuse it', async () => {
      for (let trial = 0; trial < 5; trial += 1) {
        await db.query(`DELETE FROM orders`);
        const answers = await Promise.all(Array.from({ length: 5 }, () => checkout({ courseId })));
        expect(answers.map((res) => res.status).sort((a, b) => a - b)).toEqual([
          200, 200, 200, 200, 201,
        ]);
        expect(new Set(answers.map((res) => res.body.data.order.reference)).size).toBe(1);
        expect(await orderCount()).toBe(1);
      }
    });

    it('reuses the order whatever the price is now: the amount the buyer saw', async () => {
      const first = (await checkout({ courseId })).body.data;
      await db.query(`UPDATE courses SET price_vnd = 450000 WHERE id = $1`, [courseId]);
      const again = await checkout({ courseId });
      expect(again.status).toBe(200);
      expect(again.body.data.order.reference).toBe(first.order.reference);
      expect(again.body.data.order.amountVnd).toBe(499_000);
      expect(urlParams(again.body.data.paymentUrl).vnp_Amount).toBe('49900000');
    });

    it.each([
      ['in its last minute', '30 seconds', 330],
      ['just expired, inside the 5-minute grace', '-2 minutes', 180],
    ])(
      'answers 409 ORDER_PENDING with Retry-After for an order %s, and creates nothing',
      async (_case, interval, seconds) => {
        const { reference } = (await checkout({ courseId })).body.data.order;
        await moveExpiry(reference, interval);
        const res = await checkout({ courseId });
        expect(res.status).toBe(409);
        expect(res.body).toEqual(
          envelope(
            'ORDER_PENDING',
            'Your previous payment for this course is still being confirmed.',
          ),
        );
        const retryAfter = Number(res.headers['retry-after']);
        expect(retryAfter).toBeGreaterThan(seconds - 10);
        expect(retryAfter).toBeLessThanOrEqual(seconds + 1);
        expect(await orderCount()).toBe(1);
      },
    );

    it('creates a new order once the old one is past expiry + grace, and leaves the old one pending', async () => {
      const old = (await checkout({ courseId })).body.data.order;
      await moveExpiry(old.reference, '-6 minutes');
      const res = await checkout({ courseId });
      expect(res.status).toBe(201);
      expect(res.body.data.order.reference).not.toBe(old.reference);
      // Never assumed unpaid: a late success IPN can still settle it (vnpay-ipn.e2e-spec, S9).
      const [row] = await db.query<{ status: string }[]>(
        `SELECT status FROM orders WHERE reference = $1`,
        [old.reference],
      );
      expect(row.status).toBe('pending');
    });

    it('creates a new order after a failed (cancelled) one', async () => {
      const old = (await checkout({ courseId })).body.data.order;
      await fail(old.reference);
      const res = await checkout({ courseId });
      expect(res.status).toBe(201);
      expect(res.body.data.order.reference).not.toBe(old.reference);
    });

    it('answers COURSE_ALREADY_OWNED, not a reuse, once the buyer has access', async () => {
      const order = (await checkout({ courseId })).body.data.order;
      await db.query(
        `UPDATE orders SET status = 'paid', paid_at = now(), vnp_response_code = '00' WHERE id = $1`,
        [order.id],
      );
      await insert('course_access_grants', {
        user_id: buyer.user.id,
        course_id: courseId,
        source: 'purchase',
        order_id: order.id,
      });
      expect((await checkout({ courseId })).body).toEqual(
        envelope('COURSE_ALREADY_OWNED', 'You already have access to this course.'),
      );
    });

    it("never reuses another course's or another user's order", async () => {
      const mine = (await checkout({ courseId })).body.data.order;
      const otherCourse = await insertCourse({ slug: 'khoa-khac' });
      const other = await checkout({ courseId: otherCourse });
      expect(other.status).toBe(201);
      const someoneElse = await signInAs(app);
      const theirs = await checkout({ courseId }, someoneElse.cookie);
      expect(theirs.status).toBe(201);
      const references = [mine, other.body.data.order, theirs.body.data.order].map(
        (order: { reference: string }) => order.reference,
      );
      expect(new Set(references).size).toBe(3);
    });
  });

  describe('GET /orders/:reference', () => {
    it("returns the buyer's own order, no-store; another user's is 404", async () => {
      const { reference } = (await checkout({ courseId })).body.data.order;
      const own = await server().get(`/orders/${reference}`).set('Cookie', buyer.cookie);
      expect(own.status).toBe(200);
      expect(own.headers['cache-control']).toBe('no-store');
      expect(own.body.data).toEqual(expect.objectContaining({ reference, status: 'pending' }));

      const other = await signInAs(app);
      expect((await server().get(`/orders/${reference}`).set('Cookie', other.cookie)).status).toBe(
        404,
      );
    });

    it('answers 400 for a malformed reference and 401 without a session', async () => {
      expect((await server().get('/orders/ABC').set('Cookie', buyer.cookie)).status).toBe(400);
      expect((await server().get(`/orders/${'a'.repeat(32)}`)).status).toBe(401);
    });
  });

  describe('GET /admin/orders', () => {
    it('lists orders newest first with the buyer’s public profile, filterable by status', async () => {
      const first = (await checkout({ courseId })).body.data.order;
      await fail(first.reference); // so the second checkout is a new order (S16)
      const second = (await checkout({ courseId })).body.data.order;
      const admin = await signInAs(app, { role: 'admin' });

      const res = await server().get('/admin/orders').set('Cookie', admin.cookie);
      expect(res.status).toBe(200);
      expect(res.body.data.items.map((item: { id: string }) => item.id)).toEqual([
        second.id,
        first.id,
      ]);
      expect(res.body.data.items[0]).toEqual({
        ...second,
        user: { id: buyer.user.id, displayName: 'Học viên', avatarUrl: null },
        vnpTransactionNo: null,
        vnpBankCode: null,
        vnpCardType: null,
        vnpPayDate: null,
      });
      expect(res.body.data.pageInfo).toEqual({
        page: 1,
        pageSize: 12,
        totalItems: 2,
        totalPages: 1,
      });

      const paid = await server().get('/admin/orders?status=paid').set('Cookie', admin.cookie);
      expect(paid.body.data.items).toEqual([]);
    });

    it('is admin only: 403 for an editor, 401 without a session', async () => {
      const editor = await signInAs(app, { role: 'editor' });
      expect((await server().get('/admin/orders').set('Cookie', editor.cookie)).status).toBe(403);
      expect((await server().get('/admin/orders')).status).toBe(401);
    });
  });
});
