import { CONTACT_SUBJECT_LABELS, type ContactSubject } from '../contact-subjects.js';
import type { NotificationEmail } from './contact-notifier.js';

export type NotifiedSubmission = Readonly<{
  id: string;
  name: string;
  email: string;
  subject: ContactSubject;
  message: string;
  createdAt: Date;
}>;

const vietnamTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function formatVietnamTime(instant: Date): string {
  const part = Object.fromEntries(
    vietnamTime.formatToParts(instant).map(({ type, value }) => [type, value]),
  );
  return `${part.hour}:${part.minute}:${part.second} ${part.day}/${part.month}/${part.year}`;
}

/**
 * The business-inbox notification (contact form design CF-9): plain text only, so nothing the visitor typed is
 * ever rendered as HTML. Replying answers the visitor directly.
 */
export function buildNotificationEmail(submission: NotifiedSubmission): NotificationEmail {
  const label = CONTACT_SUBJECT_LABELS[submission.subject];
  return {
    subject: `[Liên hệ] ${label} — ${submission.name}`,
    replyTo: submission.email,
    text: [
      'Có liên hệ mới từ form /lien-he.',
      '',
      `Họ tên: ${submission.name}`,
      `Email: ${submission.email}`,
      `Chủ đề: ${label}`,
      `Thời gian: ${formatVietnamTime(submission.createdAt)} (giờ Việt Nam) · ${submission.createdAt.toISOString()}`,
      `Mã liên hệ: ${submission.id}`,
      '',
      'Nội dung:',
      submission.message,
      '',
    ].join('\n'),
  };
}
