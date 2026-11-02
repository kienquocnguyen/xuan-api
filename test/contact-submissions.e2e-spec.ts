import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { XHR } from './support/auth.js';
import { createTestApp, fakeNotifier, fakeRecaptcha } from './support/create-test-app.js';
import { RECAPTCHA_TEST_HOSTNAME } from './support/fake-contact-gateways.js';
import { resetDatabase } from './support/reset-database.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const form = {
  name: '  Nguyễn Văn A ',
  email: ' A.Person@Example.com ',
  subject: 'youtube_editing_course',
  message: '  Mình muốn hỏi về khóa học.\r\nCảm ơn!  ',
};
const error = (code: string, message: string) => ({
  data: null,
  error: { code, message, details: {} },
});
const refused = error(
  'RECAPTCHA_VERIFICATION_FAILED',
  "We couldn't verify this request. Please try again.",
);
const unavailable = error(
  'CONTACT_FORM_UNAVAILABLE',
  'The contact form is temporarily unavailable. Please try again later.',
);
const rateLimited = error('RATE_LIMITED', 'Too many requests. Try again in a moment.');

type StoredRow = {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: string;
  client_ip_hash: string | null;
  notification_status: string;
  notification_attempts: number;
  notification_next_attempt_at: Date | null;
  notification_last_error: string | null;
  notification_sent_at: Date | null;
  notification_provider_message_id: string | null;
  created_at: Date;
};

describe('POST /contact-submissions (contact form design §3)', () => {
  let app: NestExpressApplication;
  let db: DataSource;

  const server = () => request(app.getHttpServer());
  /** A fresh token per call, like the web's `grecaptcha.execute` at submit time. */
  const submit = (overrides: Record<string, unknown> = {}, ip?: string) => {
    const call = server()
      .post('/contact-submissions')
      .set(XHR)
      .send({ ...form, recaptchaToken: `token-${randomUUID()}`, ...overrides });
    return ip ? call.set('X-Forwarded-For', ip) : call;
  };
  const rows = () =>
    db.query<StoredRow[]>('SELECT * FROM contact_submissions ORDER BY created_at, id');

  beforeAll(async () => {
    // One trusted hop, so X-Forwarded-For sets the client IP as Vercel's edge would (CF-8).
    app = await createTestApp([], { trustProxyHops: 1 });
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    fakeRecaptcha(app).reset();
    fakeNotifier(app).reset();
  });
  afterAll(async () => {
    await app.close();
  });

  describe('accepted', () => {
    it('answers 202 with only the receipt time, stores the normalized submission and emails the business inbox', async () => {
      const res = await submit({ recaptchaToken: 'tok-1' }, '203.0.113.7');

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ data: { receivedAt: expect.stringMatching(ISO) } });
      const [row] = await rows();
      expect(row).toEqual({
        id: expect.any(String),
        name: 'Nguyễn Văn A',
        email: 'a.person@example.com',
        subject: 'youtube_editing_course',
        message: 'Mình muốn hỏi về khóa học.\nCảm ơn!',
        status: 'new',
        client_ip_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        notification_status: 'sent',
        notification_attempts: 1,
        notification_next_attempt_at: null,
        notification_last_error: null,
        notification_sent_at: expect.any(Date),
        notification_provider_message_id: 'fake-1',
        created_at: expect.any(Date),
        updated_at: expect.any(Date),
      });
      expect(row.created_at.toISOString()).toBe(res.body.data.receivedAt);
      expect(row.client_ip_hash).not.toContain('203.0.113.7');
      expect(fakeRecaptcha(app).calls).toEqual([{ token: 'tok-1', remoteIp: '203.0.113.7' }]);

      const [sent] = fakeNotifier(app).sent;
      expect(sent.idempotencyKey).toBe(`contact-submission-${row.id}`);
      expect(sent.email.replyTo).toBe('a.person@example.com');
      expect(sent.email.subject).toBe('[Liên hệ] Khóa học YouTube Editing Workflow — Nguyễn Văn A');
      expect(sent.email.text).toContain('Mình muốn hỏi về khóa học.\nCảm ơn!');
      expect(sent.email.text).toContain(row.created_at.toISOString());
    });

    it('never puts an id, status or admin field on the wire', async () => {
      const res = await submit();
      const [row] = await rows();
      expect(Object.keys(res.body.data)).toEqual(['receivedAt']);
      expect(JSON.stringify(res.body)).not.toContain(row.id);
    });

    it('stores the submission and answers 202 when the email provider fails, scheduling a retry (CF-11)', async () => {
      fakeNotifier(app).willFail('PROVIDER_UNAVAILABLE');
      const res = await submit();

      expect(res.status).toBe(202);
      const [row] = await rows();
      expect(row).toMatchObject({
        notification_status: 'pending',
        notification_attempts: 1,
        notification_last_error: 'PROVIDER_UNAVAILABLE',
        notification_sent_at: null,
        notification_provider_message_id: null,
      });
      const [{ delay }] = await db.query<{ delay: number }[]>(
        `SELECT extract(epoch FROM notification_next_attempt_at - now())::int AS delay FROM contact_submissions`,
      );
      expect(delay).toBeGreaterThan(50);
      expect(delay).toBeLessThanOrEqual(60);
      expect(fakeNotifier(app).sent).toEqual([]);
    });

    it('keeps the notification pending, with no attempt, when no provider is configured', async () => {
      fakeNotifier(app).enabled = false;
      expect((await submit()).status).toBe(202);
      expect(await rows()).toEqual([
        expect.objectContaining({ notification_status: 'pending', notification_attempts: 0 }),
      ]);
      expect(fakeNotifier(app).attempts).toBe(0);
    });

    it('sends up to two other due notifications after a successful one (CF-13a)', async () => {
      for (const email of ['b@example.com', 'c@example.com', 'd@example.com']) {
        await db.query(
          `INSERT INTO contact_submissions (name, email, subject, message, notification_attempts, notification_next_attempt_at, notification_last_error)
           VALUES ('B', $1, 'general', 'Tin nhắn cũ hơn', 1, now() - interval '1 minute', 'TIMEOUT')`,
          [email],
        );
      }
      expect((await submit()).status).toBe(202);
      const statuses = await db.query<{ email: string; notification_status: string }[]>(
        `SELECT email, notification_status FROM contact_submissions ORDER BY email`,
      );
      expect(statuses.filter((row) => row.notification_status === 'sent')).toHaveLength(3);
      expect(fakeNotifier(app).sent).toHaveLength(3);
    });
  });

  describe('duplicates (CF-7)', () => {
    it('answers a repeat with the first receipt, writing and sending nothing more', async () => {
      const first = await submit();
      const again = await submit({ email: 'a.person@EXAMPLE.com', message: form.message.trim() });

      expect(again.status).toBe(202);
      expect(again.body).toEqual(first.body);
      expect(await rows()).toHaveLength(1);
      expect(fakeNotifier(app).sent).toHaveLength(1);
      expect(fakeRecaptcha(app).calls).toHaveLength(1);
    });

    it('stores one row for identical submissions sent at the same time', async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => submit()));
      expect(results.map((res) => res.status)).toEqual([202, 202, 202, 202, 202]);
      expect(new Set(results.map((res) => res.body.data.receivedAt)).size).toBe(1);
      expect(await rows()).toHaveLength(1);
      expect(fakeNotifier(app).sent).toHaveLength(1);
    });

    it('treats another subject or message as a new submission', async () => {
      await submit();
      await submit({ subject: 'general' });
      await submit({ message: 'Một câu hỏi khác hẳn.' });
      expect(await rows()).toHaveLength(3);
    });
  });

  describe('reCAPTCHA (CF-4, CF-5)', () => {
    it.each([
      ['an unsuccessful token', { success: false, errorCodes: ['invalid-input-response'] }],
      ['a low score', { score: 0.3 }],
      ['another action', { action: 'login' }],
      ['another hostname', { hostname: 'evil.example' }],
      ['an old challenge', { challengeTs: new Date(Date.now() - 600_000).toISOString() }],
    ])('refuses %s with 403 and stores nothing', async (_name, answer) => {
      fakeRecaptcha(app).willAnswer('bad', answer);
      const res = await submit({ recaptchaToken: 'bad' });

      expect(res.status).toBe(403);
      expect(res.body).toEqual(refused);
      expect(await rows()).toEqual([]);
      expect(fakeNotifier(app).attempts).toBe(0);
    });

    it('accepts a token from the allowed hostname at the threshold', async () => {
      fakeRecaptcha(app).willAnswer('edge', { score: 0.5, hostname: RECAPTCHA_TEST_HOSTNAME });
      expect((await submit({ recaptchaToken: 'edge' })).status).toBe(202);
    });

    it('refuses a token used a second time for another message', async () => {
      expect((await submit({ recaptchaToken: 'once' })).status).toBe(202);
      const res = await submit({ recaptchaToken: 'once', message: 'Một tin nhắn khác nữa.' });
      expect(res.status).toBe(403);
      expect(res.body).toEqual(refused);
    });

    it('fails closed with 503 when Google does not answer', async () => {
      fakeRecaptcha(app).willAnswer('down', 'unavailable');
      const res = await submit({ recaptchaToken: 'down' });
      expect(res.status).toBe(503);
      expect(res.body).toEqual(unavailable);
      expect(await rows()).toEqual([]);
    });
  });

  describe('limits (CF-6)', () => {
    it('allows 3 submissions an hour per email, then 429 with Retry-After', async () => {
      for (const n of [1, 2, 3]) {
        expect((await submit({ message: `Tin nhắn số ${n} của mình` })).status).toBe(202);
      }
      const res = await submit({ message: 'Tin nhắn số 4 của mình' });

      expect(res.status).toBe(429);
      expect(res.body).toEqual(rateLimited);
      const retryAfter = Number(res.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(3500);
      expect(retryAfter).toBeLessThanOrEqual(3600);
      expect(await rows()).toHaveLength(3);
    });

    it('allows 5 submissions an hour per client IP, counting other IPs apart', async () => {
      for (const n of [1, 2, 3, 4, 5]) {
        expect((await submit({ email: `p${n}@example.com` }, '198.51.100.1')).status).toBe(202);
      }
      const over = await submit({ email: 'p6@example.com' }, '198.51.100.1');
      expect(over.status).toBe(429);
      expect(over.body).toEqual(rateLimited);
      expect(over.headers['retry-after']).toBeDefined();
      expect((await submit({ email: 'p6@example.com' }, '198.51.100.2')).status).toBe(202);
    });

    it('counts only the last hour', async () => {
      for (const n of [1, 2, 3]) await submit({ message: `Tin nhắn cũ số ${n} nhé` });
      await db.query(`UPDATE contact_submissions SET created_at = now() - interval '61 minutes'`);
      expect((await submit({ message: 'Tin nhắn mới hôm nay' })).status).toBe(202);
    });
  });

  describe('input and transport', () => {
    it('reports every invalid field and checks nothing else', async () => {
      const res = await server()
        .post('/contact-submissions')
        .set(XHR)
        .send({ name: '', email: 'nope', subject: 'pricing', message: 'ngắn', extra: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(
        res.body.error.details.fields.map((f: { field: string; code: string }) => [
          f.field,
          f.code,
        ]),
      ).toEqual(
        expect.arrayContaining([
          ['name', 'TOO_SHORT'],
          ['email', 'INVALID_FORMAT'],
          ['subject', 'INVALID'],
          ['message', 'TOO_SHORT'],
          ['recaptchaToken', 'REQUIRED'],
          ['extra', 'UNKNOWN_FIELD'],
        ]),
      );
      expect(fakeRecaptcha(app).calls).toEqual([]);
      expect(await rows()).toEqual([]);
    });

    it('needs the CSRF header and an allowed Origin (403), but no session', async () => {
      const body = { ...form, recaptchaToken: 't' };
      const noHeader = await server().post('/contact-submissions').send(body);
      expect(noHeader.status).toBe(403);
      expect(noHeader.body.error.code).toBe('FORBIDDEN');
      const foreign = await server()
        .post('/contact-submissions')
        .set(XHR)
        .set('Origin', 'https://evil.example')
        .send(body);
      expect(foreign.status).toBe(403);
      expect(await rows()).toEqual([]);
    });
  });
});

describe('POST /contact-submissions in production without reCAPTCHA (CF-5)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApp([], {
      contact: {
        recaptcha: { mode: 'unconfigured' },
        email: { provider: 'disabled' },
        cronSecret: null,
      },
    });
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('refuses every submission with 503 and never calls Google', async () => {
    const res = await request(app.getHttpServer())
      .post('/contact-submissions')
      .set(XHR)
      .send({ ...form, recaptchaToken: 't' });
    expect(res.status).toBe(503);
    expect(res.body).toEqual(unavailable);
    expect(fakeRecaptcha(app).calls).toEqual([]);
    expect(await app.get(DataSource).query('SELECT 1 FROM contact_submissions')).toEqual([]);
  });
});
