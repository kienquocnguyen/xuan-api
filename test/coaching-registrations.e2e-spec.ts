import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  COACHING_RECAPTCHA_ACTION,
  RECAPTCHA_ACTION,
} from '../src/modules/contact/recaptcha/recaptcha.js';
import { XHR } from './support/auth.js';
import { createTestApp, fakeRecaptcha } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const error = (code: string, message: string) => ({
  data: null,
  error: { code, message, details: {} },
});
const refused = error(
  'RECAPTCHA_VERIFICATION_FAILED',
  "We couldn't verify this request. Please try again.",
);
const unavailable = error(
  'COACHING_REGISTRATION_UNAVAILABLE',
  'Registration is temporarily unavailable. Please try again later.',
);
const rateLimited = error('RATE_LIMITED', 'Too many requests. Try again in a moment.');

const kickstart = {
  program: 'channel_kickstart_session',
  name: '  Nguyễn Văn A ',
  email: ' A.Person@Example.com ',
  youtubeStage: 'has_channel',
  youtubeChannelUrl: 'youtube.com/@aperson',
  expertise: '  Mình dạy làm bánh.  ',
  goals: ['share_knowledge', 'grow_business'],
  challenges: ['too_many_topics', 'other'],
  challengeOther: ' Thiếu thời gian ',
  favoriteCreators: ' Kênh A, kênh B ',
  consent: true,
};
const threeMonth = {
  program: 'youtube_coaching_3_months',
  name: 'Trần B',
  email: 'b@example.com',
  youtubeStage: 'not_started',
  expertise: 'Mình dạy tiếng Anh.',
  goals: ['still_exploring'],
  challenges: ['unclear_direction'],
  desiredOutcome: ' Có kênh đều đặn ',
  practiceCommitment: 'can_commit',
  consent: true,
};

type StoredRow = {
  id: string;
  program: string;
  name: string;
  email: string;
  youtube_stage: string;
  youtube_channel_url: string | null;
  expertise: string;
  goals: string[];
  challenges: string[];
  challenge_other: string | null;
  desired_outcome: string | null;
  practice_commitment: string | null;
  favorite_creators: string | null;
  consented_at: Date;
  status: string;
  client_ip_hash: string | null;
  created_at: Date;
  updated_at: Date;
};

describe('POST /coaching-registrations (coaching registrations design)', () => {
  let app: NestExpressApplication;
  let db: DataSource;

  const server = () => request(app.getHttpServer());
  /** A fresh token per call (unless given), answering the coaching action like the web's `grecaptcha.execute`. */
  const submit = (
    body: Record<string, unknown> = kickstart,
    options: { ip?: string; action?: string } = {},
  ) => {
    const token = typeof body.recaptchaToken === 'string' ? body.recaptchaToken : randomUUID();
    fakeRecaptcha(app).willAnswer(token, { action: options.action ?? COACHING_RECAPTCHA_ACTION });
    const call = server()
      .post('/coaching-registrations')
      .set(XHR)
      .send({ ...body, recaptchaToken: token });
    return options.ip ? call.set('X-Forwarded-For', options.ip) : call;
  };
  const rows = () =>
    db.query<StoredRow[]>('SELECT * FROM coaching_registrations ORDER BY created_at, id');

  beforeAll(async () => {
    app = await createTestApp([], { trustProxyHops: 1 });
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    fakeRecaptcha(app).reset();
  });
  afterAll(async () => {
    await app.close();
  });

  describe('accepted', () => {
    it('stores a Kickstart registration: 202 { data: { receivedAt } } and every column, status new, consented_at set', async () => {
      const res = await submit({ ...kickstart, recaptchaToken: 'tok-1' }, { ip: '203.0.113.7' });

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ data: { receivedAt: expect.stringMatching(ISO) } });
      const [row] = await rows();
      expect(row).toEqual({
        id: expect.any(String),
        program: 'channel_kickstart_session',
        name: 'Nguyễn Văn A',
        email: 'a.person@example.com',
        youtube_stage: 'has_channel',
        youtube_channel_url: 'https://youtube.com/@aperson',
        expertise: 'Mình dạy làm bánh.',
        goals: ['share_knowledge', 'grow_business'],
        challenges: ['too_many_topics', 'other'],
        challenge_other: 'Thiếu thời gian',
        desired_outcome: null,
        practice_commitment: null,
        favorite_creators: 'Kênh A, kênh B',
        consented_at: expect.any(Date),
        status: 'new',
        client_ip_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        created_at: expect.any(Date),
        updated_at: expect.any(Date),
      });
      expect(row.created_at.toISOString()).toBe(res.body.data.receivedAt);
      expect(row.consented_at).toEqual(row.created_at);
      expect(fakeRecaptcha(app).calls).toEqual([{ token: 'tok-1', remoteIp: '203.0.113.7' }]);
    });

    it('stores a 3-month registration with desired_outcome and practice_commitment', async () => {
      const res = await submit(threeMonth);
      expect(res.status).toBe(202);
      expect(await rows()).toEqual([
        expect.objectContaining({
          program: 'youtube_coaching_3_months',
          desired_outcome: 'Có kênh đều đặn',
          practice_commitment: 'can_commit',
          youtube_channel_url: null,
          challenge_other: null,
          favorite_creators: null,
        }),
      ]);
    });

    it('stores blank optional fields as NULL', async () => {
      const res = await submit({
        ...kickstart,
        youtubeStage: 'not_started',
        youtubeChannelUrl: '  ',
        challenges: ['too_many_topics'],
        challengeOther: '   ',
        favoriteCreators: '',
      });
      expect(res.status).toBe(202);
      expect(await rows()).toEqual([
        expect.objectContaining({
          youtube_channel_url: null,
          challenge_other: null,
          favorite_creators: null,
        }),
      ]);
    });

    it('never stores the plain IP or the token', async () => {
      await submit({ ...kickstart, recaptchaToken: 'secret-token-value' }, { ip: '203.0.113.7' });
      const text = JSON.stringify((await rows())[0]);
      expect(text).not.toContain('203.0.113.7');
      expect(text).not.toContain('secret-token-value');
    });
  });

  describe('duplicates (CR-8)', () => {
    it('answers an identical repeat with the first receivedAt and writes nothing', async () => {
      const first = await submit();
      const again = await submit({ ...kickstart, email: 'a.person@EXAMPLE.com' });

      expect(again.status).toBe(202);
      expect(again.body).toEqual(first.body);
      expect(await rows()).toHaveLength(1);
      expect(fakeRecaptcha(app).calls).toHaveLength(1);
    });

    it('stores a corrected answer as a new row', async () => {
      await submit();
      await submit({ ...kickstart, goals: ['share_knowledge'] });
      await submit({ ...kickstart, favoriteCreators: undefined });
      expect(await rows()).toHaveLength(3);
    });

    it('treats the same answers on the other program as new', async () => {
      const common = {
        name: 'Trần B',
        email: 'b@example.com',
        youtubeStage: 'not_started',
        expertise: 'Mình dạy tiếng Anh.',
        goals: ['still_exploring'],
        challenges: ['too_many_topics'],
        consent: true,
      };
      await submit({ program: 'channel_kickstart_session', ...common });
      await submit({
        program: 'youtube_coaching_3_months',
        ...common,
        desiredOutcome: 'Có kênh',
        practiceCommitment: 'unsure',
      });
      expect(await rows()).toHaveLength(2);
    });

    it('two concurrent identical submits: one row, both 202', async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => submit()));
      expect(results.map((res) => res.status)).toEqual([202, 202, 202, 202, 202]);
      expect(new Set(results.map((res) => res.body.data.receivedAt)).size).toBe(1);
      expect(await rows()).toHaveLength(1);
    });

    it('a double click reusing one token: Google refuses the second, still 202 with one row', async () => {
      const results = await Promise.all([
        submit({ ...kickstart, recaptchaToken: 'double-click' }),
        submit({ ...kickstart, recaptchaToken: 'double-click' }),
      ]);
      expect(results.map((res) => res.status)).toEqual([202, 202]);
      expect(results[1].body).toEqual(results[0].body);
      expect(await rows()).toHaveLength(1);
    });
  });

  describe('limits (CR-7)', () => {
    const nth = (n: number) => ({ ...kickstart, expertise: `Chuyên môn số ${n}` });

    it('429 RATE_LIMITED with Retry-After on the 4th per email', async () => {
      for (const n of [1, 2, 3]) expect((await submit(nth(n))).status).toBe(202);
      const res = await submit(nth(4));

      expect(res.status).toBe(429);
      expect(res.body).toEqual(rateLimited);
      const retryAfter = Number(res.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(3500);
      expect(retryAfter).toBeLessThanOrEqual(3600);
      expect(await rows()).toHaveLength(3);
    });

    it('429 RATE_LIMITED with Retry-After on the 6th per IP, counting other IPs apart', async () => {
      for (const n of [1, 2, 3, 4, 5]) {
        const res = await submit(
          { ...kickstart, email: `p${n}@example.com` },
          { ip: '198.51.100.1' },
        );
        expect(res.status).toBe(202);
      }
      const over = await submit({ ...kickstart, email: 'p6@example.com' }, { ip: '198.51.100.1' });
      expect(over.status).toBe(429);
      expect(over.body).toEqual(rateLimited);
      expect(over.headers['retry-after']).toBeDefined();
      const other = await submit({ ...kickstart, email: 'p6@example.com' }, { ip: '198.51.100.2' });
      expect(other.status).toBe(202);
    });

    it('counts neither contact_submissions nor duplicates toward the limit', async () => {
      for (const n of [1, 2, 3]) {
        await db.query(
          `INSERT INTO contact_submissions (name, email, subject, message, notification_status, notification_attempts, notification_last_error)
           VALUES ('A', 'a.person@example.com', 'general', 'Tin nhắn số ${n} nhé', 'failed', 0, 'NOT_CONFIGURED')`,
        );
      }
      for (const n of [1, 1, 1, 2, 3]) expect((await submit(nth(n))).status).toBe(202);
      expect(await rows()).toHaveLength(3);
      expect((await submit(nth(4))).status).toBe(429);
    });
  });

  describe('reCAPTCHA (CR-6)', () => {
    it('403 RECAPTCHA_VERIFICATION_FAILED for the contact_submit action', async () => {
      const res = await submit(kickstart, { action: RECAPTCHA_ACTION });
      expect(res.status).toBe(403);
      expect(res.body).toEqual(refused);
      expect(await rows()).toEqual([]);
    });

    it('503 COACHING_REGISTRATION_UNAVAILABLE on a Google outage', async () => {
      fakeRecaptcha(app).willAnswer('down', 'unavailable');
      const res = await server()
        .post('/coaching-registrations')
        .set(XHR)
        .send({ ...kickstart, recaptchaToken: 'down' });
      expect(res.status).toBe(503);
      expect(res.body).toEqual(unavailable);
      expect(await rows()).toEqual([]);
    });
  });

  describe('input and transport', () => {
    it('403 FORBIDDEN without X-Requested-With', async () => {
      const res = await server()
        .post('/coaching-registrations')
        .send({ ...kickstart, recaptchaToken: 't' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(await rows()).toEqual([]);
    });

    it('400 VALIDATION_FAILED with details.fields for a bad body', async () => {
      const res = await server()
        .post('/coaching-registrations')
        .set(XHR)
        .send({ ...kickstart, name: '', goals: [], consent: false, recaptchaToken: 't' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.fields.map((f: { field: string }) => f.field)).toEqual(
        expect.arrayContaining(['name', 'goals', 'consent']),
      );
      expect(fakeRecaptcha(app).calls).toEqual([]);
      expect(await rows()).toEqual([]);
    });
  });
});

describe('POST /coaching-registrations in production without reCAPTCHA', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApp([], {
      contact: {
        recaptcha: { mode: 'unconfigured' },
        email: { provider: 'disabled' },
      },
    });
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('503 COACHING_REGISTRATION_UNAVAILABLE, never calling Google', async () => {
    const res = await request(app.getHttpServer())
      .post('/coaching-registrations')
      .set(XHR)
      .send({ ...kickstart, recaptchaToken: 't' });
    expect(res.status).toBe(503);
    expect(res.body).toEqual(unavailable);
    expect(fakeRecaptcha(app).calls).toEqual([]);
    expect(await app.get(DataSource).query('SELECT 1 FROM coaching_registrations')).toEqual([]);
  });
});
