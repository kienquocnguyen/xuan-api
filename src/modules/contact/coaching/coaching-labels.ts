import type {
  Challenge,
  CoachingProgram,
  Goal,
  PracticeCommitment,
  YoutubeStage,
} from './coaching-options.js';

/**
 * The Vietnamese labels the registration forms show, for the business-inbox email only. Nothing here goes on the
 * wire: the API still answers machine values and xuan-web keeps its own copy of these labels (CR-3, CR-12).
 * Source: the 2026-11-05 registration form PDFs.
 */
export const COACHING_PROGRAM_LABELS: Record<CoachingProgram, string> = {
  channel_kickstart_session: 'Channel Kickstart Session',
  youtube_coaching_3_months: '3-Month 1:1 YouTube Coaching',
};

export const YOUTUBE_STAGE_LABELS: Record<YoutubeStage, string> = {
  not_started: 'Mình chưa bắt đầu làm YouTube',
  has_channel: 'Mình đã có kênh YouTube',
};

export const GOAL_LABELS: Record<Goal, string> = {
  share_knowledge: 'Chia sẻ kiến thức, kinh nghiệm và giúp ích cho người khác',
  be_known_for_expertise: 'Được biết đến qua chuyên môn và những gì mình làm tốt',
  connect_with_community: 'Kết nối với những người có cùng mối quan tâm',
  build_client_trust: 'Xây dựng niềm tin với những người có thể trở thành khách hàng của mình',
  grow_business: 'Hỗ trợ phát triển công việc, sản phẩm hoặc dịch vụ của mình',
  still_exploring: 'Mình vẫn đang tìm hiểu mục tiêu phù hợp',
};

/** Keyed by program: `too_many_topics` and `cant_turn_knowledge_into_ideas` are worded differently on each form. */
export const CHALLENGE_LABELS: Record<CoachingProgram, Partial<Record<Challenge, string>>> = {
  channel_kickstart_session: {
    dont_know_where_to_start: 'Mình chưa biết nên bắt đầu từ đâu',
    too_many_topics: 'Mình có nhiều điều muốn chia sẻ nhưng chưa biết nên tập trung vào đâu',
    unclear_identity: 'Mình chưa rõ muốn được người xem nhớ đến vì điều gì',
    cant_turn_knowledge_into_ideas:
      'Mình chưa biết cách biến kiến thức và trải nghiệm thành ý tưởng video',
    videos_dont_show_value:
      'Mình đã làm video nhưng cảm thấy nội dung chưa thể hiện rõ con người và giá trị mình muốn chia sẻ',
    other: 'Mình có một vấn đề khác muốn trao đổi',
  },
  youtube_coaching_3_months: {
    unclear_direction: 'Chưa rõ hướng xây Personal Brand và nội dung YouTube',
    too_many_topics: 'Có nhiều điều muốn chia sẻ nhưng chưa biết nên tập trung vào đâu',
    cant_turn_knowledge_into_ideas:
      'Chưa biết cách phát triển kiến thức và trải nghiệm thành ý tưởng video',
    not_confident_on_camera: 'Chưa tự tin khi xuất hiện hoặc chia sẻ trước camera',
    production_difficulty: 'Gặp khó khăn trong quá trình lên kế hoạch, quay hoặc dựng video',
    dont_know_how_to_improve: 'Đã đăng video nhưng chưa biết nên nhìn vào đâu để cải thiện',
    hard_to_stay_consistent: 'Khó duy trì việc làm video đều đặn',
    other: 'Mình có một vấn đề khác muốn trao đổi',
  },
};

export const PRACTICE_COMMITMENT_LABELS: Record<PracticeCommitment, string> = {
  can_commit: 'Mình có thể chủ động dành thời gian thực hành',
  needs_arranging: 'Mình cần sắp xếp thêm thời gian nhưng muốn nghiêm túc bắt đầu',
  unsure: 'Mình chưa chắc có thể dành thời gian thực hành trong giai đoạn này',
};
