import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource, QueryFailedError } from 'typeorm';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const constraintOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof QueryFailedError) {
      return (error.driverError as { constraint?: string }).constraint;
    }
    throw error;
  }
  throw new Error('expected the statement to fail');
};

// Raw SQL on purpose: the database's own constraints (contact form design, database.md §12).
describe('contact_submissions invariants', () => {
  let app: NestExpressApplication;
  let db: DataSource;

  const insert = (columns: Record<string, unknown> = {}) => {
    const row: Record<string, unknown> = {
      name: 'A',
      email: 'a@example.com',
      subject: 'general',
      message: 'Xin chào bạn',
      notification_status: 'pending',
      notification_attempted_at: new Date(),
      ...columns,
    };
    const names = Object.keys(row);
    return db.query<{ id: string }[]>(
      `INSERT INTO contact_submissions (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(row),
    );
  };

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('fills a uuid v7 id, the new status, zero attempts and timestamps by default', async () => {
    const [{ id }] = await insert();
    const [row] = await db.query(
      `SELECT id, status, notification_attempts, created_at, updated_at, client_ip_hash
         FROM contact_submissions WHERE id = $1`,
      [id],
    );
    expect(row).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7/),
      status: 'new',
      notification_attempts: 0,
      created_at: expect.any(Date),
      updated_at: expect.any(Date),
      client_ip_hash: null,
    });
  });

  it('has no default notification status: every insert decides it', async () => {
    const failure = await insert({ notification_status: undefined }).catch((error) => error);
    expect(failure).toBeInstanceOf(QueryFailedError);
    expect((failure.driverError as { code: string }).code).toBe('23502'); // not_null_violation
  });

  it.each([
    ['ck_contact_submissions_email_lowercase', { email: 'A@Example.com' }],
    ['ck_contact_submissions_subject', { subject: 'pricing' }],
    ['ck_contact_submissions_name_not_blank', { name: ' \n ' }],
    ['ck_contact_submissions_message_not_blank', { message: '\t\n ' }],
    ['ck_contact_submissions_status', { status: 'spam' }],
    ['ck_contact_submissions_notification_status', { notification_status: 'queued' }],
    ['ck_contact_submissions_notification_attempts', { notification_attempts: -1 }],
    ['ck_contact_submissions_notification_pending_attempt', { notification_attempted_at: null }],
    [
      'ck_contact_submissions_notification_failed_error',
      { notification_status: 'failed', notification_last_error: null },
    ],
    ['ck_contact_submissions_notification_last_error', { notification_last_error: 'boom' }],
    ['ck_contact_submissions_notification_sent_pair', { notification_status: 'sent' }],
    ['ck_contact_submissions_notification_sent_pair', { notification_sent_at: new Date() }],
  ])('rejects a row breaking %s', async (constraint, columns) => {
    expect(await constraintOf(insert(columns))).toBe(constraint);
  });

  it('accepts sent, failed and never-attempted (NOT_CONFIGURED) notifications', async () => {
    await insert({
      notification_status: 'sent',
      notification_sent_at: new Date(),
      notification_provider_message_id: 'msg',
    });
    await insert({ notification_status: 'failed', notification_last_error: 'PROVIDER_REJECTED' });
    await insert({
      notification_status: 'failed',
      notification_attempts: 0,
      notification_attempted_at: null,
      notification_last_error: 'NOT_CONFIGURED',
    });
    const [{ n }] = await db.query<{ n: number }[]>(
      'SELECT count(*)::int AS n FROM contact_submissions',
    );
    expect(n).toBe(3);
  });

  it('declares the three named indexes and the primary key, with no retry-schedule index', async () => {
    const rows = await db.query<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'contact_submissions' ORDER BY indexname`,
    );
    expect(rows.map((row) => row.indexname)).toEqual([
      'ix_contact_submissions_client_ip_hash_created_at',
      'ix_contact_submissions_email_created_at',
      'ix_contact_submissions_status_created_at_id',
      'pk_contact_submissions',
    ]);
  });
});
