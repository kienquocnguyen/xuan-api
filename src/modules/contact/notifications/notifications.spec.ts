import type { DataSource } from 'typeorm';
import type { ContactSubmission } from '../contact-submission.entity.js';
import { toAdminContactSubmissionDto } from '../dto/admin-contact-submission.dto.js';
import { type ContactNotifier, NotificationDeliveryError } from './contact-notifier.js';
import {
  ContactNotificationsService,
  STALE_ATTEMPT_SECONDS,
} from './contact-notifications.service.js';
import { buildNotificationEmail } from './notification-email.js';
import { ResendContactNotifier } from './resend-contact-notifier.js';

describe('ContactNotificationsService (contact form design CF-10 to CF-13)', () => {
  const submission = {
    id: '01900000-0000-7000-8000-000000000001',
    name: 'A',
    email: 'a@example.com',
    subject: 'general' as const,
    message: 'Xin chào bạn',
    createdAt: new Date('2026-11-03T07:00:00Z'),
  };
  const setup = (send: ContactNotifier['send'], claimed: unknown[] = [submission]) => {
    const query = vi.fn(async (sql: string, _params?: unknown[]) =>
      sql.includes('RETURNING') ? [claimed, 1] : [],
    );
    const notifier = { enabled: true, send: vi.fn(send) };
    const service = new ContactNotificationsService({ query } as unknown as DataSource, notifier);
    const writes = () => query.mock.calls.map(([sql, params]) => ({ sql, params }));
    return { service, notifier, writes };
  };

  it('makes one attempt for a new submission and records sent with the provider id', async () => {
    const { service, notifier, writes } = setup(async () => ({ providerMessageId: 'msg_1' }));
    await service.deliverNew(submission);

    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(notifier.send.mock.calls[0][1]).toBe(`contact-submission-${submission.id}`);
    const [write] = writes();
    expect(write.sql).toContain(`notification_status = 'sent'`);
    expect(write.params).toEqual([submission.id, 'msg_1']);
    expect(writes()).toHaveLength(1);
  });

  it('records failed with the category when the provider fails, and never sent', async () => {
    const { service, writes } = setup(async () => {
      throw new NotificationDeliveryError('TIMEOUT');
    });
    await service.deliverNew(submission);

    expect(writes()).toHaveLength(1);
    expect(writes()[0].sql).toContain(`notification_status = 'failed'`);
    expect(writes()[0].sql).toContain(`notification_status = 'pending'`); // never downgrades a sent one
    expect(writes()[0].params).toEqual([submission.id, 'TIMEOUT']);
  });

  it('never throws from the inline attempt, leaving the row pending on an unexpected error', async () => {
    const { service, writes } = setup(async () => {
      throw new Error('bug');
    });
    await expect(service.deliverNew(submission)).resolves.toBeUndefined();
    expect(writes()).toEqual([]);
  });

  it('retries only what the conditional claim returned', async () => {
    const claimedNothing = setup(async () => ({ providerMessageId: 'msg_2' }), []);
    expect(await claimedNothing.service.retry(submission.id)).toBe('not_retryable');
    expect(claimedNothing.notifier.send).not.toHaveBeenCalled();

    const claimed = setup(async () => ({ providerMessageId: 'msg_2' }));
    expect(await claimed.service.retry(submission.id)).toBe('sent');
    const [claim] = claimed.writes();
    expect(claim.sql).toContain(`notification_status = 'failed'`);
    expect(claim.sql).toContain('notification_attempted_at < now() - make_interval');
    expect(claim.params).toEqual([submission.id, STALE_ATTEMPT_SECONDS]);
  });
});

describe('notification.retryable (CF-13)', () => {
  const now = new Date('2026-11-03T10:00:00Z');
  const row = (fields: Partial<ContactSubmission>) =>
    ({
      id: 'x',
      name: 'A',
      email: 'a@example.com',
      subject: 'general',
      message: 'Xin chào bạn',
      status: 'new',
      clientIpHash: null,
      notificationStatus: 'pending',
      notificationAttempts: 1,
      notificationAttemptedAt: now,
      notificationLastError: null,
      notificationSentAt: null,
      notificationProviderMessageId: null,
      createdAt: now,
      updatedAt: now,
      ...fields,
    }) as ContactSubmission;
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

  it.each([
    ['failed', { notificationStatus: 'failed', notificationLastError: 'TIMEOUT' }, true],
    ['sent', { notificationStatus: 'sent', notificationSentAt: now }, false],
    ['pending, attempt running', { notificationAttemptedAt: ago(STALE_ATTEMPT_SECONDS) }, false],
    ['pending, attempt stale', { notificationAttemptedAt: ago(STALE_ATTEMPT_SECONDS + 1) }, true],
  ] as const)('%s → %s', (_name, fields, retryable) => {
    expect(toAdminContactSubmissionDto(row(fields), now).notification.retryable).toBe(retryable);
  });
});

describe('buildNotificationEmail', () => {
  const submission = {
    id: '01900000-0000-7000-8000-000000000001',
    name: 'Nguyễn Văn A',
    email: 'a@example.com',
    subject: 'youtube_coaching_3_months' as const,
    message: 'Xin chào,\n<b>mình</b> muốn hỏi về coaching.',
    createdAt: new Date('2026-11-03T07:05:09.123Z'),
  };

  it('carries sender, subject label, message and creation time as plain text, replying to the sender', () => {
    const email = buildNotificationEmail(submission);
    expect(email.subject).toBe(
      '[Liên hệ] Hỏi về chương trình 3-Month 1:1 YouTube Coaching — Nguyễn Văn A',
    );
    expect(email.replyTo).toBe('a@example.com');
    expect(email.text).toBe(
      [
        'Có liên hệ mới từ form /lien-he.',
        '',
        'Họ tên: Nguyễn Văn A',
        'Email: a@example.com',
        'Chủ đề: Hỏi về chương trình 3-Month 1:1 YouTube Coaching',
        'Thời gian: 14:05:09 03/11/2026 (giờ Việt Nam) · 2026-11-03T07:05:09.123Z',
        'Mã liên hệ: 01900000-0000-7000-8000-000000000001',
        '',
        'Nội dung:',
        'Xin chào,',
        '<b>mình</b> muốn hỏi về coaching.',
        '',
      ].join('\n'),
    );
  });
});

describe('ResendContactNotifier', () => {
  const settings = {
    apiKey: 're_test_key',
    from: 'XuanCreative <contact@mail.xuancreative.com>',
    to: 'business@example.com',
  };
  const email = { subject: 'S', text: 'T', replyTo: 'a@example.com' };
  const respond = (status: number, body: unknown) =>
    vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('is enabled', () => {
    expect(new ResendContactNotifier(settings).enabled).toBe(true);
  });

  it("sends one plain-text email through Resend's API with an idempotency key", async () => {
    const fetchFn = respond(200, { id: 'msg_123' });
    const result = await new ResendContactNotifier(settings, fetchFn).send(email, 'key-1');

    expect(result).toEqual({ providerMessageId: 'msg_123' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer re_test_key',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'key-1',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init?.body as string)).toEqual({
      from: settings.from,
      to: [settings.to],
      reply_to: 'a@example.com',
      subject: 'S',
      text: 'T',
    });
  });

  it.each([
    ['PROVIDER_UNAVAILABLE', 'a 5xx', respond(500, { message: 'boom' })],
    ['PROVIDER_UNAVAILABLE', 'a 429', respond(429, { message: 'slow down' })],
    ['PROVIDER_REJECTED', 'a 4xx', respond(422, { message: 'domain not verified' })],
    ['PROVIDER_REJECTED', 'a 401', respond(401, { message: 'bad key' })],
    ['INVALID_RESPONSE', 'a 2xx without an id', respond(200, {})],
    [
      'INVALID_RESPONSE',
      'a 2xx that is not JSON',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('ok', { status: 200 })),
    ],
    [
      'NETWORK_ERROR',
      'a network failure',
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')),
    ],
  ])('classifies %s for %s and never claims success', async (category, _name, fetchFn) => {
    const sending = new ResendContactNotifier(settings, fetchFn).send(email, 'k');
    await expect(sending).rejects.toBeInstanceOf(NotificationDeliveryError);
    await expect(sending).rejects.toMatchObject({ category });
  });

  it('times out as TIMEOUT', async () => {
    const hanging = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
        ),
    );
    await expect(
      new ResendContactNotifier(settings, hanging, 20).send(email, 'k'),
    ).rejects.toMatchObject({ category: 'TIMEOUT' });
  });

  it('never puts the API key in an error message', async () => {
    const sending = new ResendContactNotifier(
      settings,
      respond(401, { message: 're_test_key' }),
    ).send(email, 'k');
    await expect(sending).rejects.toSatisfy(
      (error: Error) => !error.message.includes(settings.apiKey),
    );
  });
});
