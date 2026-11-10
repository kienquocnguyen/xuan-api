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

const kickstart = {
  program: 'channel_kickstart_session',
  challenges: ['dont_know_where_to_start'],
};
const threeMonth = {
  program: 'youtube_coaching_3_months',
  challenges: ['unclear_direction'],
  desired_outcome: 'Một kênh đều đặn',
  practice_commitment: 'can_commit',
};

// Raw SQL on purpose: the database's own constraints (coaching registrations design, database.md §12).
describe('coaching_registrations invariants', () => {
  let app: NestExpressApplication;
  let db: DataSource;

  const insert = (
    columns: Record<string, unknown> = {},
    base: Record<string, unknown> = kickstart,
  ) => {
    const row: Record<string, unknown> = {
      name: 'A',
      email: 'a@example.com',
      youtube_stage: 'has_channel',
      expertise: 'Dạy nấu ăn',
      goals: ['share_knowledge'],
      consented_at: new Date(),
      notification_status: 'pending',
      notification_attempted_at: new Date(),
      ...base,
      ...columns,
    };
    for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key];
    const names = Object.keys(row);
    return db.query<{ id: string }[]>(
      `INSERT INTO coaching_registrations (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
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

  it.each([
    ['channel_kickstart_session', kickstart],
    ['youtube_coaching_3_months', threeMonth],
  ])('accepts a valid %s row with the new status and a uuid v7 id', async (_program, base) => {
    const [{ id }] = await insert({}, base);
    const [row] = await db.query(
      `SELECT id, status, client_ip_hash, created_at, updated_at FROM coaching_registrations WHERE id = $1`,
      [id],
    );
    expect(row).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7/),
      status: 'new',
      client_ip_hash: null,
      created_at: expect.any(Date),
      updated_at: expect.any(Date),
    });
  });

  it.each([
    ['ck_coaching_registrations_program', { program: 'other' }],
    ['ck_coaching_registrations_name_not_blank', { name: ' \n ' }],
    ['ck_coaching_registrations_email_lowercase', { email: 'A@Example.com' }],
    ['ck_coaching_registrations_youtube_stage', { youtube_stage: 'maybe' }],
    [
      'ck_coaching_registrations_channel_url_stage',
      { youtube_stage: 'not_started', youtube_channel_url: 'https://youtube.com/@a' },
    ],
    ['ck_coaching_registrations_expertise_not_blank', { expertise: '\t ' }],
    ['ck_coaching_registrations_goals', { goals: [] }],
    ['ck_coaching_registrations_goals', { goals: ['share_knowledge', 'get_rich'] }],
    [
      'ck_coaching_registrations_challenges',
      { program: 'channel_kickstart_session', challenges: ['not_confident_on_camera'] },
    ],
    ['ck_coaching_registrations_challenges', { challenges: [] }],
    [
      'ck_coaching_registrations_challenge_other',
      { challenges: ['too_many_topics'], challenge_other: 'x' },
    ],
    [
      'ck_coaching_registrations_challenge_other',
      { ...threeMonth, challenges: ['other'], challenge_other: null },
    ],
    ['ck_coaching_registrations_three_month_fields', { ...threeMonth, desired_outcome: null }],
    [
      'ck_coaching_registrations_three_month_fields',
      { desired_outcome: 'x', practice_commitment: 'can_commit' },
    ],
    [
      'ck_coaching_registrations_practice_commitment',
      { ...threeMonth, practice_commitment: 'maybe' },
    ],
    ['ck_coaching_registrations_status', { status: 'approved' }],
    ['ck_coaching_registrations_notification_status', { notification_status: 'queued' }],
    ['ck_coaching_registrations_notification_attempts', { notification_attempts: -1 }],
    ['ck_coaching_registrations_notification_pending_attempt', { notification_attempted_at: null }],
    [
      'ck_coaching_registrations_notification_failed_error',
      { notification_status: 'failed', notification_last_error: null },
    ],
    ['ck_coaching_registrations_notification_last_error', { notification_last_error: 'boom' }],
    ['ck_coaching_registrations_notification_sent_pair', { notification_status: 'sent' }],
    ['ck_coaching_registrations_notification_sent_pair', { notification_sent_at: new Date() }],
  ])('rejects a row breaking %s', async (constraint, columns) => {
    expect(await constraintOf(insert(columns))).toBe(constraint);
  });

  it('has no default notification status: every insert decides it (CR-12)', async () => {
    const failure = await insert({ notification_status: undefined }).catch((error) => error);
    expect(failure).toBeInstanceOf(QueryFailedError);
    expect((failure.driverError as { code: string }).code).toBe('23502'); // not_null_violation
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
      'SELECT count(*)::int AS n FROM coaching_registrations',
    );
    expect(n).toBe(3);
  });

  it('accepts other with its text on both programs, and a Kickstart other without text', async () => {
    await insert({ challenges: ['other'], challenge_other: 'Điều khác' });
    await insert({ ...threeMonth, challenges: ['other'], challenge_other: 'Điều khác' });
    await insert({ challenges: ['other'], challenge_other: null });
    const [{ n }] = await db.query<{ n: number }[]>(
      'SELECT count(*)::int AS n FROM coaching_registrations',
    );
    expect(n).toBe(3);
  });

  it('declares the three named indexes and the primary key', async () => {
    const rows = await db.query<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'coaching_registrations' ORDER BY indexname`,
    );
    expect(rows.map((row) => row.indexname)).toEqual([
      'ix_coaching_registrations_client_ip_hash_created_at',
      'ix_coaching_registrations_email_created_at',
      'ix_coaching_registrations_status_created_at_id',
      'pk_coaching_registrations',
    ]);
  });
});
