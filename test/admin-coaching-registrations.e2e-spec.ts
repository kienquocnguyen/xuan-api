import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { signInAs, XHR } from './support/auth.js';
import { createTestApp } from './support/create-test-app.js';
import { resetDatabase } from './support/reset-database.js';

const UNKNOWN_ID = '01900000-0000-7000-8000-000000000000';
const IP_HASH = 'f'.repeat(64);
const notFound = {
  data: null,
  error: { code: 'NOT_FOUND', message: 'The requested resource was not found.', details: {} },
};

describe('Admin coaching registrations inbox', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let admin: string;

  const server = () => request(app.getHttpServer());
  const get = (path: string, cookie = admin) =>
    server().get(`/admin/coaching-registrations${path}`).set('Cookie', cookie);
  const post = (path: string, cookie = admin) =>
    server().post(`/admin/coaching-registrations${path}`).set(XHR).set('Cookie', cookie);
  const ids = async (query: string) =>
    (await get(query)).body.data.items.map((item: { id: string }) => item.id);

  /** Inserted directly, with fixed times, independent of the public route. */
  const insert = async (columns: Record<string, unknown> = {}) => {
    const row: Record<string, unknown> = {
      program: 'channel_kickstart_session',
      name: 'Nguyễn Văn A',
      email: 'a@example.com',
      youtube_stage: 'has_channel',
      youtube_channel_url: 'https://www.youtube.com/@aperson',
      expertise: 'Mình dạy làm bánh.',
      goals: ['share_knowledge', 'grow_business'],
      challenges: ['too_many_topics', 'other'],
      challenge_other: 'Thiếu thời gian',
      favorite_creators: 'Kênh A',
      consented_at: new Date('2026-11-09T09:00:00Z'),
      client_ip_hash: IP_HASH,
      created_at: new Date('2026-11-09T09:00:00Z'),
      updated_at: new Date('2026-11-09T09:00:00Z'),
      ...columns,
    };
    const names = Object.keys(row);
    const [{ id }] = await db.query<{ id: string }[]>(
      `INSERT INTO coaching_registrations (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(row),
    );
    return id;
  };
  const threeMonth = {
    program: 'youtube_coaching_3_months',
    email: 'b@example.com',
    youtube_stage: 'not_started',
    youtube_channel_url: null,
    challenges: ['unclear_direction'],
    challenge_other: null,
    desired_outcome: 'Có kênh đều đặn',
    practice_commitment: 'can_commit',
    favorite_creators: null,
  };
  const dto = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    program: 'channel_kickstart_session',
    name: 'Nguyễn Văn A',
    email: 'a@example.com',
    youtubeStage: 'has_channel',
    youtubeChannelUrl: 'https://www.youtube.com/@aperson',
    expertise: 'Mình dạy làm bánh.',
    goals: ['share_knowledge', 'grow_business'],
    challenges: ['too_many_topics', 'other'],
    challengeOther: 'Thiếu thời gian',
    desiredOutcome: null,
    practiceCommitment: null,
    favoriteCreators: 'Kênh A',
    status: 'new',
    consentedAt: '2026-11-09T09:00:00.000Z',
    createdAt: '2026-11-09T09:00:00.000Z',
    updatedAt: '2026-11-09T09:00:00.000Z',
    ...overrides,
  });
  const stored = async () =>
    db.query<{ status: string; updated_at: Date }[]>(
      'SELECT status, updated_at FROM coaching_registrations',
    );

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    ({ cookie: admin } = await signInAs(app, { role: 'admin' }));
  });
  afterAll(async () => {
    await app.close();
  });

  describe('GET /admin/coaching-registrations', () => {
    it('lists newest first with exact items and pageInfo', async () => {
      const older = await insert({ created_at: new Date('2026-11-01T09:00:00Z') });
      const newer = await insert({ ...threeMonth });

      const res = await get('?pageSize=1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: {
          items: [
            dto(newer, {
              program: 'youtube_coaching_3_months',
              email: 'b@example.com',
              youtubeStage: 'not_started',
              youtubeChannelUrl: null,
              challenges: ['unclear_direction'],
              challengeOther: null,
              desiredOutcome: 'Có kênh đều đặn',
              practiceCommitment: 'can_commit',
              favoriteCreators: null,
            }),
          ],
          pageInfo: { page: 1, pageSize: 1, totalItems: 2, totalPages: 2 },
        },
      });
      expect(JSON.stringify(res.body)).not.toContain(IP_HASH);
      expect(await ids('?page=2&pageSize=1')).toEqual([older]);
    });

    it('filters by status, by program and by both', async () => {
      const fresh = await insert();
      const contacted = await insert({ status: 'contacted', email: 'c@example.com' });
      const threeNew = await insert({ ...threeMonth });
      const threeArchived = await insert({ ...threeMonth, status: 'archived' });

      expect(await ids('?status=contacted')).toEqual([contacted]);
      expect((await ids('?status=new')).sort()).toEqual([fresh, threeNew].sort());
      expect((await ids('?program=youtube_coaching_3_months')).sort()).toEqual(
        [threeNew, threeArchived].sort(),
      );
      expect(await ids('?program=youtube_coaching_3_months&status=archived')).toEqual([
        threeArchived,
      ]);
      expect((await get('')).body.data.pageInfo.totalItems).toBe(4);
    });

    it.each([['?status=spam'], ['?program=other'], ['?pageSize=51'], ['?extra=1']])(
      'rejects %s with 400',
      async (query) => {
        const res = await get(query);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      },
    );
  });

  describe('GET /admin/coaching-registrations/:registrationId', () => {
    it('returns one registration with the exact DTO and no client IP field', async () => {
      const id = await insert();
      const res = await get(`/${id}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: dto(id) });
      expect(JSON.stringify(res.body)).not.toContain(IP_HASH);
      expect(Object.keys(res.body.data)).not.toContain('clientIpHash');
    });

    it('reading does not change status', async () => {
      const id = await insert();
      await get(`/${id}`);
      await get('');
      const [row] = await stored();
      expect(row.status).toBe('new');
      expect(row.updated_at).toEqual(new Date('2026-11-09T09:00:00Z'));
    });

    it('404 for an unknown id and 400 INVALID_FORMAT for a malformed one', async () => {
      expect((await get(`/${UNKNOWN_ID}`)).body).toEqual(notFound);
      const res = await get('/not-a-uuid');
      expect(res.status).toBe(400);
      expect(res.body.error.details.fields).toEqual([
        { field: 'registrationId', code: 'INVALID_FORMAT', message: expect.any(String) },
      ]);
    });
  });

  describe('POST …/contacted and …/archive', () => {
    it('marks new as contacted; repeating does not touch updated_at', async () => {
      const id = await insert();
      const res = await post(`/${id}/contacted`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id, status: 'contacted' });
      expect(res.body.data.updatedAt).not.toBe('2026-11-09T09:00:00.000Z');

      const again = await post(`/${id}/contacted`);
      expect(again.status).toBe(200);
      expect(again.body.data.updatedAt).toBe(res.body.data.updatedAt);
    });

    it('does not move archived back to contacted', async () => {
      const id = await insert({ status: 'archived' });
      const res = await post(`/${id}/contacted`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: dto(id, { status: 'archived' }) });
    });

    it('archives from new and contacted; repeating does not touch updated_at', async () => {
      const fresh = await insert();
      const contacted = await insert({ status: 'contacted', email: 'b@example.com' });
      for (const id of [fresh, contacted]) {
        const res = await post(`/${id}/archive`);
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('archived');
        expect(res.body.data.updatedAt).not.toBe('2026-11-09T09:00:00.000Z');
        const again = await post(`/${id}/archive`);
        expect(again.status).toBe(200);
        expect(again.body.data.updatedAt).toBe(res.body.data.updatedAt);
      }
    });

    it('404 for an unknown registration', async () => {
      expect((await post(`/${UNKNOWN_ID}/contacted`)).body).toEqual(notFound);
      expect((await post(`/${UNKNOWN_ID}/archive`)).body).toEqual(notFound);
    });
  });

  describe('access', () => {
    it('401 anonymous, 403 editor and user on every route', async () => {
      const id = await insert();
      const base = '/admin/coaching-registrations';
      const anonymous = [
        await server().get(base),
        await server().get(`${base}/${id}`),
        await server().post(`${base}/${id}/contacted`).set(XHR),
        await server().post(`${base}/${id}/archive`).set(XHR),
      ];
      expect(anonymous.map((res) => res.status)).toEqual([401, 401, 401, 401]);
      for (const role of ['user', 'editor'] as const) {
        const { cookie } = await signInAs(app, { role });
        const forbidden = [
          await get('', cookie),
          await get(`/${id}`, cookie),
          await post(`/${id}/contacted`, cookie),
          await post(`/${id}/archive`, cookie),
        ];
        expect(forbidden.map((res) => res.status)).toEqual([403, 403, 403, 403]);
      }
      const [row] = await stored();
      expect(row.status).toBe('new');
    });

    it('403 FORBIDDEN on writes without X-Requested-With', async () => {
      const id = await insert();
      for (const action of ['contacted', 'archive']) {
        const res = await server()
          .post(`/admin/coaching-registrations/${id}/${action}`)
          .set('Cookie', admin);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      const [row] = await stored();
      expect(row.status).toBe('new');
    });
  });
});
