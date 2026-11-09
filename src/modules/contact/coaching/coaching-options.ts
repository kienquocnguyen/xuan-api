/** Answer values of the coaching registration forms (coaching registrations design CR-3). xuan-web owns the labels. */
export const COACHING_PROGRAMS = [
  'channel_kickstart_session',
  'youtube_coaching_3_months',
] as const;
export type CoachingProgram = (typeof COACHING_PROGRAMS)[number];

export const YOUTUBE_STAGES = ['not_started', 'has_channel'] as const;
export type YoutubeStage = (typeof YOUTUBE_STAGES)[number];

export const GOALS = [
  'share_knowledge',
  'be_known_for_expertise',
  'connect_with_community',
  'build_client_trust',
  'grow_business',
  'still_exploring',
] as const;
export type Goal = (typeof GOALS)[number];

export const KICKSTART_CHALLENGES = [
  'dont_know_where_to_start',
  'too_many_topics',
  'unclear_identity',
  'cant_turn_knowledge_into_ideas',
  'videos_dont_show_value',
  'other',
] as const;

export const THREE_MONTH_CHALLENGES = [
  'unclear_direction',
  'too_many_topics',
  'cant_turn_knowledge_into_ideas',
  'not_confident_on_camera',
  'production_difficulty',
  'dont_know_how_to_improve',
  'hard_to_stay_consistent',
  'other',
] as const;
export type Challenge =
  (typeof KICKSTART_CHALLENGES)[number] | (typeof THREE_MONTH_CHALLENGES)[number];

export const PRACTICE_COMMITMENTS = ['can_commit', 'needs_arranging', 'unsure'] as const;
export type PracticeCommitment = (typeof PRACTICE_COMMITMENTS)[number];

/** `new` waits for Xuan's review; no approve/reject state (CR-5). */
export const COACHING_REGISTRATION_STATUSES = ['new', 'contacted', 'archived'] as const;
export type CoachingRegistrationStatus = (typeof COACHING_REGISTRATION_STATUSES)[number];
