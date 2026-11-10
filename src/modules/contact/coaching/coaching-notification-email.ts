import type { NotificationEmail } from '../notifications/contact-notifier.js';
import { formatVietnamTime } from '../notifications/notification-email.js';
import {
  CHALLENGE_LABELS,
  COACHING_PROGRAM_LABELS,
  GOAL_LABELS,
  PRACTICE_COMMITMENT_LABELS,
  YOUTUBE_STAGE_LABELS,
} from './coaching-labels.js';
import type {
  Challenge,
  CoachingProgram,
  Goal,
  PracticeCommitment,
  YoutubeStage,
} from './coaching-options.js';

/** A stored registration, as the email needs it. */
export type NotifiedRegistration = Readonly<{
  id: string;
  program: CoachingProgram;
  name: string;
  email: string;
  youtubeStage: YoutubeStage;
  youtubeChannelUrl: string | null;
  expertise: string;
  goals: readonly Goal[];
  challenges: readonly Challenge[];
  challengeOther: string | null;
  desiredOutcome: string | null;
  practiceCommitment: PracticeCommitment | null;
  favoriteCreators: string | null;
  phone: string | null;
  createdAt: Date;
}>;

const NOT_ANSWERED = '(không trả lời)';
const bullets = (labels: readonly string[]) => labels.map((label) => `- ${label}`);

/**
 * The business-inbox notification for a new registration (CR-12): plain text only, so nothing the visitor typed is
 * ever rendered as HTML, with every answer under its question and the forms' own labels. Replying answers the
 * registrant directly. An unknown value (impossible behind the table's checks) falls back to the value itself.
 */
export function buildCoachingNotificationEmail(
  registration: NotifiedRegistration,
  adminUrl: string,
): NotificationEmail {
  const program = COACHING_PROGRAM_LABELS[registration.program];
  const challengeLabels = CHALLENGE_LABELS[registration.program];
  const threeMonth = registration.program === 'youtube_coaching_3_months';
  const lines = [
    `Có đăng ký mới cho ${program}.`,
    `Xem và cập nhật trạng thái: ${adminUrl}`,
    '',
    `Họ tên: ${registration.name}`,
    `Email: ${registration.email}`,
    `Số điện thoại: ${registration.phone ?? 'Không có'}`,
    `Chương trình: ${program}`,
    `Thời gian: ${formatVietnamTime(registration.createdAt)} (giờ Việt Nam)`,
    `Mã đăng ký: ${registration.id}`,
    '',
    'Bạn đang ở giai đoạn nào với YouTube?',
    `- ${YOUTUBE_STAGE_LABELS[registration.youtubeStage] ?? registration.youtubeStage}`,
    ...(registration.youtubeStage === 'has_channel'
      ? ['', 'Link kênh YouTube:', registration.youtubeChannelUrl ?? NOT_ANSWERED]
      : []),
    '',
    'Kiến thức, kỹ năng hoặc trải nghiệm muốn chia sẻ trên YouTube:',
    registration.expertise,
    '',
    'Mục tiêu khi xây Personal Brand trên YouTube:',
    ...bullets(registration.goals.map((goal) => GOAL_LABELS[goal] ?? goal)),
    ...(threeMonth
      ? [
          '',
          'Sau 3 tháng coaching, bạn mong muốn mình đã làm được những gì?',
          registration.desiredOutcome ?? NOT_ANSWERED,
        ]
      : []),
    '',
    'Điều đang khiến bạn gặp khó khăn với YouTube:',
    ...bullets(registration.challenges.map((challenge) => challengeLabels[challenge] ?? challenge)),
    ...(registration.challenges.includes('other')
      ? ['', 'Chia sẻ thêm:', registration.challengeOther ?? NOT_ANSWERED]
      : []),
    ...(threeMonth
      ? [
          '',
          'Thời gian thực hành trong 12 tuần tới:',
          `- ${
            registration.practiceCommitment
              ? (PRACTICE_COMMITMENT_LABELS[registration.practiceCommitment] ??
                registration.practiceCommitment)
              : NOT_ANSWERED
          }`,
        ]
      : []),
    '',
    'Kênh YouTube hoặc creator yêu thích:',
    registration.favoriteCreators ?? NOT_ANSWERED,
    '',
  ];
  return {
    subject: `Đăng ký mới: ${program} - ${registration.name}`,
    replyTo: registration.email,
    text: lines.join('\n'),
  };
}
