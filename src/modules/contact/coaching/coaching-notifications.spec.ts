import type { DataSource } from 'typeorm';
import type { AppConfig } from '../../../config/load-config.js';
import {
  type ContactNotifier,
  NotificationDeliveryError,
  type NotificationEmail,
} from '../notifications/contact-notifier.js';
import { STALE_ATTEMPT_SECONDS } from '../notifications/stale-attempt.js';
import type { HumanCheckService } from '../recaptcha/human-check.service.js';
import type { CoachingRegistration } from './coaching-registration.entity.js';
import {
  buildCoachingNotificationEmail,
  type NotifiedRegistration,
} from './coaching-notification-email.js';
import { CoachingNotificationsService } from './coaching-notifications.service.js';
import { CoachingRegistrationsService } from './coaching-registrations.service.js';
import { toAdminCoachingRegistrationDto } from './dto/admin-coaching-registration.dto.js';
import type { CreateCoachingRegistrationInput } from './dto/create-coaching-registration.dto.js';

const ADMIN_URL = 'https://xuancreative.com/admin/coaching';
const config = {
  auth: { webUrl: 'https://xuancreative.com', cookieSecret: 'x'.repeat(32) },
  contact: { recaptcha: { mode: 'bypass' } },
} as unknown as AppConfig;

const kickstart: NotifiedRegistration = {
  id: '01900000-0000-7000-8000-000000000001',
  program: 'channel_kickstart_session',
  name: 'Nguyễn Văn A',
  email: 'a@example.com',
  youtubeStage: 'has_channel',
  youtubeChannelUrl: 'https://www.youtube.com/@aperson',
  expertise: 'Mình dạy làm bánh.\nĐã 5 năm.',
  goals: ['share_knowledge', 'grow_business'],
  challenges: ['too_many_topics', 'other'],
  challengeOther: 'Thiếu thời gian',
  desiredOutcome: null,
  practiceCommitment: null,
  favoriteCreators: 'Kênh A',
  createdAt: new Date('2026-11-10T02:05:09Z'),
};
const threeMonth: NotifiedRegistration = {
  ...kickstart,
  id: '01900000-0000-7000-8000-000000000002',
  program: 'youtube_coaching_3_months',
  name: 'Trần B',
  email: 'b@example.com',
  youtubeStage: 'not_started',
  youtubeChannelUrl: null,
  goals: ['still_exploring'],
  challenges: ['too_many_topics', 'hard_to_stay_consistent'],
  challengeOther: null,
  desiredOutcome: 'Có kênh đều đặn.',
  practiceCommitment: 'needs_arranging',
  favoriteCreators: null,
};

describe('buildCoachingNotificationEmail (CR-12)', () => {
  it('names the program and the registrant, replies to the registrant, and lists every Kickstart answer by its label', () => {
    expect(buildCoachingNotificationEmail(kickstart, ADMIN_URL)).toEqual<NotificationEmail>({
      subject: 'Đăng ký mới: Channel Kickstart Session - Nguyễn Văn A',
      replyTo: 'a@example.com',
      text: [
        'Có đăng ký mới cho Channel Kickstart Session.',
        'Xem và cập nhật trạng thái: https://xuancreative.com/admin/coaching',
        '',
        'Họ tên: Nguyễn Văn A',
        'Email: a@example.com',
        'Chương trình: Channel Kickstart Session',
        'Thời gian: 09:05:09 10/11/2026 (giờ Việt Nam)',
        'Mã đăng ký: 01900000-0000-7000-8000-000000000001',
        '',
        'Bạn đang ở giai đoạn nào với YouTube?',
        '- Mình đã có kênh YouTube',
        '',
        'Link kênh YouTube:',
        'https://www.youtube.com/@aperson',
        '',
        'Kiến thức, kỹ năng hoặc trải nghiệm muốn chia sẻ trên YouTube:',
        'Mình dạy làm bánh.\nĐã 5 năm.',
        '',
        'Mục tiêu khi xây Personal Brand trên YouTube:',
        '- Chia sẻ kiến thức, kinh nghiệm và giúp ích cho người khác',
        '- Hỗ trợ phát triển công việc, sản phẩm hoặc dịch vụ của mình',
        '',
        'Điều đang khiến bạn gặp khó khăn với YouTube:',
        '- Mình có nhiều điều muốn chia sẻ nhưng chưa biết nên tập trung vào đâu',
        '- Mình có một vấn đề khác muốn trao đổi',
        '',
        'Chia sẻ thêm:',
        'Thiếu thời gian',
        '',
        'Kênh YouTube hoặc creator yêu thích:',
        'Kênh A',
        '',
      ].join('\n'),
    });
  });

  it('adds the 3-month questions, uses that form’s challenge wording, and marks empty optional answers', () => {
    const { subject, replyTo, text } = buildCoachingNotificationEmail(threeMonth, ADMIN_URL);
    expect(subject).toBe('Đăng ký mới: 3-Month 1:1 YouTube Coaching - Trần B');
    expect(replyTo).toBe('b@example.com');
    expect(text).toContain(
      [
        'Bạn đang ở giai đoạn nào với YouTube?',
        '- Mình chưa bắt đầu làm YouTube',
        '',
        'Kiến thức',
      ].join('\n'),
    ); // no channel question without a channel
    expect(text).toContain(
      [
        'Mục tiêu khi xây Personal Brand trên YouTube:',
        '- Mình vẫn đang tìm hiểu mục tiêu phù hợp',
        '',
        'Sau 3 tháng coaching, bạn mong muốn mình đã làm được những gì?',
        'Có kênh đều đặn.',
        '',
        'Điều đang khiến bạn gặp khó khăn với YouTube:',
        '- Có nhiều điều muốn chia sẻ nhưng chưa biết nên tập trung vào đâu',
        '- Khó duy trì việc làm video đều đặn',
        '',
        'Thời gian thực hành trong 12 tuần tới:',
        '- Mình cần sắp xếp thêm thời gian nhưng muốn nghiêm túc bắt đầu',
        '',
        'Kênh YouTube hoặc creator yêu thích:',
        '(không trả lời)',
        '',
      ].join('\n'),
    );
    expect(text).not.toContain('Chia sẻ thêm:'); // `other` not chosen
    expect(text).not.toMatch(/still_exploring|needs_arranging|hard_to_stay_consistent|not_started/);
  });

  it('marks optional answers left empty on Kickstart, and never shows the 3-month questions', () => {
    const { text } = buildCoachingNotificationEmail(
      { ...kickstart, youtubeChannelUrl: null, challengeOther: null, favoriteCreators: null },
      ADMIN_URL,
    );
    expect(text).toContain('Link kênh YouTube:\n(không trả lời)\n');
    expect(text).toContain('Chia sẻ thêm:\n(không trả lời)\n');
    expect(text).toContain('Kênh YouTube hoặc creator yêu thích:\n(không trả lời)\n');
    expect(text).not.toContain('Sau 3 tháng');
    expect(text).not.toContain('Thời gian thực hành');
  });
});

/** One scripted database for both services: records every statement, answers by its shape. */
function fakeDatabase(options: { duplicate?: Date; claimed?: NotifiedRegistration[] } = {}) {
  const statements: { sql: string; params: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    statements.push({ sql, params });
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.includes('AS "receivedAt" FROM coaching_registrations'))
      return options.duplicate ? [{ receivedAt: options.duplicate }] : [];
    if (sql.includes('AS "emailCount"'))
      return [{ emailCount: 0, emailRetry: null, ipCount: 0, ipRetry: null }];
    if (sql.includes('INSERT INTO coaching_registrations'))
      return [{ id: kickstart.id, receivedAt: kickstart.createdAt }];
    if (sql.includes('RETURNING')) return [options.claimed ?? [], 1]; // the retry claim
    return [];
  });
  const manager = { query };
  const dataSource = {
    query,
    manager,
    transaction: async <T>(work: (tx: typeof manager) => Promise<T>) => work(manager),
  } as unknown as DataSource;
  const insert = () => statements.find(({ sql }) => sql.includes('INSERT INTO'));
  const updates = () => statements.filter(({ sql }) => sql.trimStart().startsWith('UPDATE'));
  return { dataSource, statements, insert, updates };
}

function fakeNotifier(
  enabled: boolean,
  send: ContactNotifier['send'] = async () => ({ providerMessageId: 'msg_1' }),
) {
  return { enabled, send: vi.fn(send) };
}

describe('CoachingRegistrationsService and its notification (CR-12)', () => {
  const input = {
    program: 'channel_kickstart_session',
    name: kickstart.name,
    email: kickstart.email,
    youtubeStage: 'has_channel',
    youtubeChannelUrl: 'https://www.youtube.com/@aperson',
    expertise: kickstart.expertise,
    goals: ['share_knowledge', 'grow_business'],
    challenges: ['too_many_topics', 'other'],
    challengeOther: 'Thiếu thời gian',
    favoriteCreators: 'Kênh A',
    consent: true,
    recaptchaToken: 'token-1',
  } as unknown as CreateCoachingRegistrationInput;
  const humanCheck = { check: vi.fn(async () => 'pass') } as unknown as HumanCheckService;

  const setup = (notifier: ReturnType<typeof fakeNotifier>, db = fakeDatabase()) => {
    const notifications = new CoachingNotificationsService(db.dataSource, notifier, config);
    const service = new CoachingRegistrationsService(
      db.dataSource,
      config,
      humanCheck,
      notifications,
    );
    return { service, db };
  };

  it('sent: claims the attempt with the insert, sends one email after the commit, and records sent', async () => {
    const notifier = fakeNotifier(true);
    const { service, db } = setup(notifier);

    expect(await service.submit(input, '203.0.113.7')).toEqual({ receivedAt: kickstart.createdAt });

    expect(db.insert()?.params.at(-1)).toBe(true); // notification `pending`, 1 attempt
    expect(notifier.send).toHaveBeenCalledTimes(1);
    const [email, key] = notifier.send.mock.calls[0];
    expect(key).toBe(`coaching-registration-${kickstart.id}`);
    expect(email).toEqual(buildCoachingNotificationEmail(kickstart, ADMIN_URL));
    expect(db.updates()).toHaveLength(1);
    expect(db.updates()[0].sql).toContain(`notification_status = 'sent'`);
    expect(db.updates()[0].params).toEqual([kickstart.id, 'msg_1']);
  });

  it('provider failure: still answers the receipt and records failed with the category only', async () => {
    const notifier = fakeNotifier(true, async () => {
      throw new NotificationDeliveryError('PROVIDER_UNAVAILABLE');
    });
    const { service, db } = setup(notifier);

    expect(await service.submit(input, null)).toEqual({ receivedAt: kickstart.createdAt });

    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(db.updates()).toHaveLength(1);
    expect(db.updates()[0].sql).toContain(`notification_status = 'failed'`);
    expect(db.updates()[0].sql).toContain(`notification_status = 'pending'`); // never downgrades sent
    expect(db.updates()[0].params).toEqual([kickstart.id, 'PROVIDER_UNAVAILABLE']);
  });

  it('an unexpected error while sending still answers the receipt and leaves the row pending', async () => {
    const notifier = fakeNotifier(true, async () => {
      throw new Error('bug');
    });
    const { service, db } = setup(notifier);

    expect(await service.submit(input, null)).toEqual({ receivedAt: kickstart.createdAt });
    expect(db.updates()).toEqual([]);
  });

  it('not configured: stores the registration as failed NOT_CONFIGURED and sends nothing', async () => {
    const notifier = fakeNotifier(false);
    const { service, db } = setup(notifier);

    expect(await service.submit(input, null)).toEqual({ receivedAt: kickstart.createdAt });

    expect(db.insert()?.params.at(-1)).toBe(false); // `failed`, `NOT_CONFIGURED`, 0 attempts
    expect(db.insert()?.sql).toContain(`'NOT_CONFIGURED'`);
    expect(notifier.send).not.toHaveBeenCalled();
    expect(db.updates()).toEqual([]);
  });

  it('duplicate: answers the first receivedAt, inserts nothing and sends no second email', async () => {
    const first = new Date('2026-11-10T01:00:00Z');
    const notifier = fakeNotifier(true);
    const { service, db } = setup(notifier, fakeDatabase({ duplicate: first }));

    expect(await service.submit(input, null)).toEqual({ receivedAt: first });

    expect(db.insert()).toBeUndefined();
    expect(notifier.send).not.toHaveBeenCalled();
    expect(db.updates()).toEqual([]);
  });
});

describe('CoachingNotificationsService.retry (CR-12, as CF-13)', () => {
  it('sends only what the conditional claim returned, with the same idempotency key', async () => {
    const nothing = fakeDatabase({ claimed: [] });
    const idle = fakeNotifier(true);
    const notNow = new CoachingNotificationsService(nothing.dataSource, idle, config);
    expect(await notNow.retry(kickstart.id)).toBe('not_retryable');
    expect(idle.send).not.toHaveBeenCalled();

    const claimed = fakeDatabase({ claimed: [threeMonth] });
    const notifier = fakeNotifier(true);
    const service = new CoachingNotificationsService(claimed.dataSource, notifier, config);
    expect(await service.retry(threeMonth.id)).toBe('sent');
    const [claim] = claimed.statements;
    expect(claim.sql).toContain(`notification_status = 'failed'`);
    expect(claim.sql).toContain('notification_attempted_at < now() - make_interval');
    expect(claim.sql).toContain('notification_attempts = notification_attempts + 1');
    expect(claim.params).toEqual([threeMonth.id, STALE_ATTEMPT_SECONDS]);
    expect(notifier.send.mock.calls[0][1]).toBe(`coaching-registration-${threeMonth.id}`);
  });
});

describe('AdminCoachingRegistrationDto.notification', () => {
  const now = new Date('2026-11-10T10:00:00Z');
  const row = (fields: Partial<CoachingRegistration>) =>
    ({
      ...kickstart,
      consentedAt: kickstart.createdAt,
      updatedAt: kickstart.createdAt,
      status: 'new',
      clientIpHash: 'f'.repeat(64),
      notificationStatus: 'sent',
      notificationAttempts: 1,
      notificationAttemptedAt: new Date('2026-11-10T09:59:00Z'),
      notificationLastError: null,
      notificationSentAt: new Date('2026-11-10T09:59:01Z'),
      notificationProviderMessageId: 'msg_1',
      ...fields,
    }) as CoachingRegistration;

  it('shows the delivery state, never the provider message id or the client IP hash', () => {
    const dto = toAdminCoachingRegistrationDto(row({}), now);
    expect(dto.notification).toEqual({
      status: 'sent',
      attempts: 1,
      lastAttemptAt: '2026-11-10T09:59:00.000Z',
      lastError: null,
      sentAt: '2026-11-10T09:59:01.000Z',
      retryable: false,
    });
    expect(JSON.stringify(dto)).not.toMatch(/msg_1|clientIpHash|f{64}/);
  });

  it('is retryable when failed, or pending past the stale window, and not while an attempt runs', () => {
    const failed = row({
      notificationStatus: 'failed',
      notificationLastError: 'TIMEOUT',
      notificationSentAt: null,
    });
    expect(toAdminCoachingRegistrationDto(failed, now).notification.retryable).toBe(true);
    const pending = (secondsAgo: number) =>
      row({
        notificationStatus: 'pending',
        notificationSentAt: null,
        notificationAttemptedAt: new Date(now.getTime() - secondsAgo * 1000),
      });
    expect(toAdminCoachingRegistrationDto(pending(30), now).notification.retryable).toBe(false);
    expect(
      toAdminCoachingRegistrationDto(pending(STALE_ATTEMPT_SECONDS + 1), now).notification
        .retryable,
    ).toBe(true);
  });
});
