import { z } from 'zod';
import { codePointLength, formEmail, formName, formText } from '../../dto/form-text.js';
import {
  GOALS,
  KICKSTART_CHALLENGES,
  PRACTICE_COMMITMENTS,
  THREE_MONTH_CHALLENGES,
  YOUTUBE_STAGES,
} from '../coaching-options.js';

export const COACHING_TEXT_MAX = 5000;
export const COACHING_CREATORS_MAX = 2000;
export const COACHING_CHANNEL_URL_MAX = 500;

const hasScheme = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

const isYoutubeUrl = (value: string): boolean => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password || url.port) return false;
  const host = url.hostname;
  return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
};

/** Trimmed; no scheme means `https://`; blank stays blank. Plain string in OpenAPI (`overwrite`, not `transform`). */
const channelUrl = z
  .string()
  .overwrite((value) => {
    const trimmed = value.trim();
    return trimmed === '' || hasScheme.test(trimmed) ? trimmed : `https://${trimmed}`;
  })
  .superRefine(codePointLength(0, COACHING_CHANNEL_URL_MAX))
  .refine((value) => value === '' || isYoutubeUrl(value), {
    message: 'Use a link on youtube.com or youtu.be.',
  });

const unique = (values: readonly string[]) => new Set(values).size === values.length;

const goals = z
  .array(z.enum(GOALS))
  .min(1)
  .refine(unique, { message: 'Each goal can be chosen once.' });

const challengesOf = <const T extends readonly [string, ...string[]]>(options: T) =>
  z.array(z.enum(options)).min(1).refine(unique, { message: 'Each challenge can be chosen once.' });

const common = {
  name: formName,
  email: formEmail,
  youtubeStage: z.enum(YOUTUBE_STAGES),
  youtubeChannelUrl: channelUrl.optional(),
  expertise: formText(1, COACHING_TEXT_MAX),
  goals,
  challengeOther: formText(0, COACHING_TEXT_MAX).optional(),
  favoriteCreators: formText(0, COACHING_CREATORS_MAX).optional(),
  consent: z.literal(true),
  recaptchaToken: z.string().min(1).max(4096),
};

type CrossFieldInput = {
  youtubeStage: (typeof YOUTUBE_STAGES)[number];
  youtubeChannelUrl?: string | undefined;
  challenges: readonly string[];
  challengeOther?: string | undefined;
};

/** Rules across fields; a blank optional string counts as absent. Issues sit on the field that is wrong. */
const crossFieldRules =
  (otherRequired: boolean) => (value: CrossFieldInput, ctx: z.RefinementCtx) => {
    if (value.youtubeStage !== 'has_channel' && value.youtubeChannelUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['youtubeChannelUrl'],
        message: 'A channel link goes with "has a channel".',
      });
    }
    const hasOther = value.challenges.includes('other');
    if (!hasOther && value.challengeOther) {
      ctx.addIssue({
        code: 'custom',
        path: ['challengeOther'],
        message: 'Write this only when "other" is chosen.',
      });
    }
    if (otherRequired && hasOther && !value.challengeOther) {
      ctx.addIssue({
        code: 'custom',
        path: ['challengeOther'],
        message: 'Tell us what "other" is.',
      });
    }
  };

const kickstart = z
  .strictObject({
    program: z.literal('channel_kickstart_session'),
    ...common,
    challenges: challengesOf(KICKSTART_CHALLENGES),
  })
  .superRefine(crossFieldRules(false))
  .meta({ id: 'CreateChannelKickstartRegistrationDto' });

const threeMonth = z
  .strictObject({
    program: z.literal('youtube_coaching_3_months'),
    ...common,
    challenges: challengesOf(THREE_MONTH_CHALLENGES),
    desiredOutcome: formText(1, COACHING_TEXT_MAX),
    practiceCommitment: z.enum(PRACTICE_COMMITMENTS),
  })
  .superRefine(crossFieldRules(true))
  .meta({ id: 'CreateThreeMonthCoachingRegistrationDto' });

/** The public coaching registration forms (coaching registrations design, request fields). The token is never stored. */
export const createCoachingRegistrationSchema = z
  .discriminatedUnion('program', [kickstart, threeMonth])
  .meta({ id: 'CreateCoachingRegistrationDto' });
export type CreateCoachingRegistrationInput = z.infer<typeof createCoachingRegistrationSchema>;
