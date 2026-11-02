import { NotificationDeliveryError } from './contact-notifier.js';
import { buildNotificationEmail } from './notification-email.js';
import { MAX_AUTOMATIC_ATTEMPTS, retryDelaySeconds } from './notification-schedule.js';
import { ResendContactNotifier } from './resend-contact-notifier.js';

describe('retryDelaySeconds (contact form design CF-12)', () => {
  it('backs off after each failed automatic attempt, then gives up after the fifth', () => {
    expect([1, 2, 3, 4, 5, 6].map(retryDelaySeconds)).toEqual([60, 300, 1800, 7200, null, null]);
    expect(MAX_AUTOMATIC_ATTEMPTS).toBe(5);
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
    expect(email.subject).toBe('[Liên hệ] Coaching 1:1 YouTube 3 tháng — Nguyễn Văn A');
    expect(email.replyTo).toBe('a@example.com');
    expect(email.text).toBe(
      [
        'Có liên hệ mới từ form /lien-he.',
        '',
        'Họ tên: Nguyễn Văn A',
        'Email: a@example.com',
        'Chủ đề: Coaching 1:1 YouTube 3 tháng',
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
