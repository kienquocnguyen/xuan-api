import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp, fakeNotifier } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const CRON_SECRET = 'cron-secret-for-tests-0123456789';
const ROUTE = '/internal/contact-notifications/deliver-due';

describe('Scheduled notification delivery (contact form design CF-12, CF-13b)', () => {
  let app: NestExpressApplication;
  let db: DataSource;

  const sweep = (authorization = `Bearer ${CRON_SECRET}`) =>
    request(app.getHttpServer()).get(ROUTE).set('Authorization', authorization);
  let counter = 0;
  const insert = async (columns: Record<string, unknown>) => {
    counter += 1;
    const row: Record<string, unknown> = {
      name: 'A',
      email: `p${counter}@example.com`,
      subject: 'general',
      message: 'Xin chào bạn ơi',
      ...columns,
    };
    const names = Object.keys(row);
    const [{ id }] = await db.query<{ id: string }[]>(
      `INSERT INTO contact_submissions (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(row),
    );
    return id;
  };
  const due = (attempts = 1) =>
    insert({
      notification_attempts: attempts,
      notification_next_attempt_at: new Date(Date.now() - 60_000),
      notification_last_error: 'TIMEOUT',
    });
  const state = async (id: string) =>
    (
      await db.query<
        {
          notification_status: string;
          notification_attempts: number;
          notification_last_error: string | null;
          next_in: number | null;
        }[]
      >(
        `SELECT notification_status, notification_attempts, notification_last_error,
                extract(epoch FROM notification_next_attempt_at - now())::int AS next_in
           FROM contact_submissions WHERE id = $1`,
        [id],
      )
    )[0];

  beforeAll(async () => {
    app = await createTestApp([], {
      contact: {
        recaptcha: { mode: 'bypass' },
        email: { provider: 'disabled' },
        cronSecret: CRON_SECRET,
      },
    });
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    fakeNotifier(app).reset();
  });
  afterAll(async () => {
    await app.close();
  });

  it('needs the bearer secret (401) and no session or CSRF header', async () => {
    await due();
    for (const authorization of ['', 'Bearer wrong', CRON_SECRET, `Basic ${CRON_SECRET}`]) {
      const res = await sweep(authorization);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
    expect(fakeNotifier(app).attempts).toBe(0);
  });

  it('sends due notifications only, and reports what it did', async () => {
    const [a, b] = [await due(), await due(2)];
    const later = await insert({
      notification_attempts: 1,
      notification_next_attempt_at: new Date(Date.now() + 600_000),
    });
    const failed = await insert({
      notification_status: 'failed',
      notification_attempts: 5,
      notification_next_attempt_at: null,
    });

    const res = await sweep();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { attempted: 2, sent: 2, retrying: 0, failed: 0 } });
    expect((await state(a)).notification_status).toBe('sent');
    expect((await state(b)).notification_attempts).toBe(3);
    expect(await state(later)).toMatchObject({
      notification_status: 'pending',
      notification_attempts: 1,
    });
    expect((await state(failed)).notification_status).toBe('failed');
    expect(
      fakeNotifier(app)
        .sent.map((s) => s.idempotencyKey)
        .sort(),
    ).toEqual([`contact-submission-${a}`, `contact-submission-${b}`].sort());
  });

  it('backs off after a failure and gives up after the fifth automatic attempt', async () => {
    const second = await due(1);
    const fifth = await due(4);
    fakeNotifier(app).willFail('PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE');

    expect((await sweep()).body.data).toEqual({ attempted: 2, sent: 0, retrying: 1, failed: 1 });
    const retrying = await state(second);
    expect(retrying).toMatchObject({
      notification_status: 'pending',
      notification_attempts: 2,
      notification_last_error: 'PROVIDER_UNAVAILABLE',
    });
    expect(retrying.next_in).toBeGreaterThan(290);
    expect(retrying.next_in).toBeLessThanOrEqual(300);
    expect(await state(fifth)).toEqual({
      notification_status: 'failed',
      notification_attempts: 5,
      notification_last_error: 'PROVIDER_UNAVAILABLE',
      next_in: null,
    });
  });

  it('sends at most 20 per run', async () => {
    for (let n = 0; n < 22; n += 1) await due();
    expect((await sweep()).body.data).toEqual({ attempted: 20, sent: 20, retrying: 0, failed: 0 });
    expect((await sweep()).body.data.sent).toBe(2);
  });

  it('never claims one notification twice when runs overlap', async () => {
    for (let n = 0; n < 6; n += 1) await due();
    const runs = await Promise.all([sweep(), sweep(), sweep()]);
    const total = runs.reduce((sum, res) => sum + res.body.data.attempted, 0);
    expect(total).toBe(6);
    expect(new Set(fakeNotifier(app).sent.map((s) => s.idempotencyKey)).size).toBe(6);
  });
});

describe('The scheduled delivery route without CRON_SECRET', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('does not exist (404), whatever is sent', async () => {
    const res = await request(app.getHttpServer())
      .get(ROUTE)
      .set('Authorization', 'Bearer anything-at-all-long-enough');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
