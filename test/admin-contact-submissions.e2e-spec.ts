import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { signInAs, XHR } from './support/auth.js';
import { createTestApp, fakeNotifier } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const UNKNOWN_ID = '01900000-0000-7000-8000-000000000000';
const notFound = {
  data: null,
  error: { code: 'NOT_FOUND', message: 'The requested resource was not found.', details: {} },
};

describe('Admin contact inbox (contact form design CF-14)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let admin: string;

  const server = () => request(app.getHttpServer());
  const get = (path: string, cookie = admin) =>
    server().get(`/admin/contact-submissions${path}`).set('Cookie', cookie);
  const post = (path: string, cookie = admin) =>
    server().post(`/admin/contact-submissions${path}`).set(XHR).set('Cookie', cookie);
  /** Inserted directly, with fixed times, independent of the public route. */
  const insert = async (columns: Record<string, unknown> = {}) => {
    const row: Record<string, unknown> = {
      name: 'Nguyễn Văn A',
      email: 'a@example.com',
      subject: 'general',
      message: 'Xin chào, mình muốn hợp tác.',
      client_ip_hash: 'f'.repeat(64),
      notification_next_attempt_at: new Date('2026-11-03T10:00:00Z'),
      created_at: new Date('2026-11-03T09:00:00Z'),
      updated_at: new Date('2026-11-03T09:00:00Z'),
      ...columns,
    };
    const names = Object.keys(row);
    const [{ id }] = await db.query<{ id: string }[]>(
      `INSERT INTO contact_submissions (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(row),
    );
    return id;
  };
  const dto = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    name: 'Nguyễn Văn A',
    email: 'a@example.com',
    subject: 'general',
    message: 'Xin chào, mình muốn hợp tác.',
    status: 'new',
    notification: {
      status: 'pending',
      attempts: 0,
      nextAttemptAt: '2026-11-03T10:00:00.000Z',
      lastError: null,
      sentAt: null,
    },
    createdAt: '2026-11-03T09:00:00.000Z',
    updatedAt: '2026-11-03T09:00:00.000Z',
    ...overrides,
  });

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    fakeNotifier(app).reset();
    ({ cookie: admin } = await signInAs(app, { role: 'admin' }));
  });
  afterAll(async () => {
    await app.close();
  });

  describe('GET /admin/contact-submissions', () => {
    it('pages newest first with exact DTOs and never the IP hash', async () => {
      const older = await insert({ created_at: new Date('2026-11-01T09:00:00Z') });
      const newer = await insert({ email: 'b@example.com' });

      const res = await get('?pageSize=1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: {
          items: [dto(newer, { email: 'b@example.com' })],
          pageInfo: { page: 1, pageSize: 1, totalItems: 2, totalPages: 2 },
        },
      });
      expect(JSON.stringify(res.body)).not.toContain('f'.repeat(64));
      const second = await get('?page=2&pageSize=1');
      expect(second.body.data.items.map((item: { id: string }) => item.id)).toEqual([older]);
    });

    it('filters by status', async () => {
      await insert();
      const read = await insert({ status: 'read' });
      const archived = await insert({ status: 'archived' });
      const ids = async (status: string) =>
        (await get(`?status=${status}`)).body.data.items.map((item: { id: string }) => item.id);
      expect(await ids('read')).toEqual([read]);
      expect(await ids('archived')).toEqual([archived]);
      expect((await get('')).body.data.pageInfo.totalItems).toBe(3);
    });

    it.each([['?status=spam'], ['?pageSize=51'], ['?extra=1']])(
      'rejects %s with 400',
      async (query) => {
        const res = await get(query);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      },
    );
  });

  describe('GET /admin/contact-submissions/:submissionId', () => {
    it('returns the submission without marking it read', async () => {
      const id = await insert({
        notification_status: 'sent',
        notification_attempts: 1,
        notification_next_attempt_at: null,
        notification_sent_at: new Date('2026-11-03T09:00:05Z'),
        notification_provider_message_id: 'msg_1',
      });
      const res = await get(`/${id}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: dto(id, {
          notification: {
            status: 'sent',
            attempts: 1,
            nextAttemptAt: null,
            lastError: null,
            sentAt: '2026-11-03T09:00:05.000Z',
          },
        }),
      });
      const [{ status }] = await db.query('SELECT status FROM contact_submissions');
      expect(status).toBe('new');
    });

    it('answers 404 for an unknown id and 400 INVALID_FORMAT for a malformed one', async () => {
      expect((await get(`/${UNKNOWN_ID}`)).body).toEqual(notFound);
      const res = await get('/not-a-uuid');
      expect(res.status).toBe(400);
      expect(res.body.error.details.fields).toEqual([
        { field: 'submissionId', code: 'INVALID_FORMAT', message: expect.any(String) },
      ]);
    });
  });

  describe('POST …/read and …/archive', () => {
    it('marks a new submission read, then answers repeats without writing', async () => {
      const id = await insert();
      const res = await post(`/${id}/read`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id, status: 'read' });
      expect(res.body.data.updatedAt).not.toBe('2026-11-03T09:00:00.000Z');

      const again = await post(`/${id}/read`);
      expect(again.body.data.updatedAt).toBe(res.body.data.updatedAt);
    });

    it('leaves an archived submission archived when marked read', async () => {
      const id = await insert({ status: 'archived' });
      const res = await post(`/${id}/read`);
      expect(res.body).toEqual({ data: dto(id, { status: 'archived' }) });
    });

    it('archives new and read submissions, idempotently', async () => {
      const fresh = await insert();
      const read = await insert({ status: 'read', email: 'b@example.com' });
      for (const id of [fresh, read]) {
        expect((await post(`/${id}/archive`)).body.data.status).toBe('archived');
      }
      const again = await post(`/${fresh}/archive`);
      expect(again.status).toBe(200);
      expect(again.body.data.status).toBe('archived');
    });

    it('answers 404 for an unknown submission', async () => {
      expect((await post(`/${UNKNOWN_ID}/read`)).body).toEqual(notFound);
      expect((await post(`/${UNKNOWN_ID}/archive`)).body).toEqual(notFound);
    });
  });

  describe('POST …/notification/retry (CF-13c)', () => {
    it('sends a failed notification now, after automatic attempts ran out', async () => {
      const id = await insert({
        notification_status: 'failed',
        notification_attempts: 5,
        notification_next_attempt_at: null,
        notification_last_error: 'PROVIDER_REJECTED',
      });
      const res = await post(`/${id}/notification/retry`);
      expect(res.status).toBe(200);
      expect(res.body.data.notification).toEqual({
        status: 'sent',
        attempts: 6,
        nextAttemptAt: null,
        lastError: null,
        sentAt: expect.any(String),
      });
      expect(fakeNotifier(app).sent).toHaveLength(1);
    });

    it('keeps a failed notification failed when the retry fails too', async () => {
      const id = await insert({
        notification_status: 'failed',
        notification_attempts: 5,
        notification_next_attempt_at: null,
      });
      fakeNotifier(app).willFail('TIMEOUT');
      const res = await post(`/${id}/notification/retry`);
      expect(res.body.data.notification).toMatchObject({
        status: 'failed',
        attempts: 6,
        nextAttemptAt: null,
        lastError: 'TIMEOUT',
      });
    });

    it('leaves a sent notification alone', async () => {
      const id = await insert({
        notification_status: 'sent',
        notification_attempts: 1,
        notification_next_attempt_at: null,
        notification_sent_at: new Date('2026-11-03T09:00:05Z'),
      });
      expect((await post(`/${id}/notification/retry`)).body.data.notification.attempts).toBe(1);
      expect(fakeNotifier(app).attempts).toBe(0);
    });

    it('changes nothing without a configured provider', async () => {
      fakeNotifier(app).enabled = false;
      const id = await insert();
      expect((await post(`/${id}/notification/retry`)).body).toEqual({ data: dto(id) });
    });

    it('answers 404 for an unknown submission', async () => {
      expect((await post(`/${UNKNOWN_ID}/notification/retry`)).body).toEqual(notFound);
    });
  });

  describe('access', () => {
    it('needs a session (401), the admin role (403) and, for writes, the CSRF header (403)', async () => {
      const id = await insert();
      expect((await server().get('/admin/contact-submissions')).status).toBe(401);
      for (const role of ['user', 'editor'] as const) {
        const { cookie } = await signInAs(app, { role });
        expect((await get('', cookie)).status).toBe(403);
        expect((await get(`/${id}`, cookie)).status).toBe(403);
        expect((await post(`/${id}/archive`, cookie)).status).toBe(403);
      }
      const noCsrf = await server()
        .post(`/admin/contact-submissions/${id}/archive`)
        .set('Cookie', admin);
      expect(noCsrf.status).toBe(403);
      const [{ status }] = await db.query('SELECT status FROM contact_submissions');
      expect(status).toBe('new');
    });
  });
});
