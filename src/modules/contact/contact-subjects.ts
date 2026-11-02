/** Contact subjects: stable machine values (contract identifiers, I19; contact form design CF-2). */
export const CONTACT_SUBJECTS = [
  'youtube_editing_course',
  'channel_kickstart_session',
  'youtube_coaching_3_months',
  'general',
] as const;
export type ContactSubject = (typeof CONTACT_SUBJECTS)[number];

/** The Vietnamese labels the web shows and the notification email uses. Never sent on the wire. */
export const CONTACT_SUBJECT_LABELS: Readonly<Record<ContactSubject, string>> = {
  youtube_editing_course: 'Khóa học YouTube Editing Workflow',
  channel_kickstart_session: 'Buổi Channel Kickstart Session',
  youtube_coaching_3_months: 'Coaching 1:1 YouTube 3 tháng',
  general: 'Liên hệ chung hoặc hợp tác',
};
