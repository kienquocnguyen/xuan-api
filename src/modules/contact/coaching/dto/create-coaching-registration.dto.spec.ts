import {
  toFieldErrors,
  type FieldError,
  type SchemaIssue,
} from '../../../../http/to-field-errors.js';
import { createCoachingRegistrationSchema } from './create-coaching-registration.dto.js';

const common = {
  name: 'Nguyễn Văn A',
  email: 'a@example.com',
  youtubeStage: 'has_channel',
  expertise: 'Mình dạy nấu ăn.',
  goals: ['share_knowledge'],
  consent: true,
  recaptchaToken: 'token-1',
};
const kickstart = {
  ...common,
  program: 'channel_kickstart_session',
  challenges: ['too_many_topics'],
};
const threeMonth = {
  ...common,
  program: 'youtube_coaching_3_months',
  challenges: ['unclear_direction'],
  desiredOutcome: 'Có kênh ổn định.',
  practiceCommitment: 'can_commit',
};

describe('CreateCoachingRegistrationDto (coaching registrations design, request fields)', () => {
  const run = (base: Record<string, unknown>, overrides: Record<string, unknown>) => {
    const body = { ...base, ...overrides };
    for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key];
    return createCoachingRegistrationSchema.safeParse(body);
  };
  const errorsOf = (result: ReturnType<typeof run>): FieldError[] =>
    result.success ? [] : toFieldErrors(result.error.issues as unknown as SchemaIssue[]);
  const expectError = (
    base: Record<string, unknown>,
    overrides: Record<string, unknown>,
    field: string,
    code: FieldError['code'],
  ) => {
    const result = run(base, overrides);
    expect(result.success).toBe(false);
    expect(errorsOf(result)).toContainEqual(expect.objectContaining({ field, code }));
  };

  it.each([
    ['kickstart', kickstart],
    ['three-month', threeMonth],
  ])('accepts a minimal %s body', (_name, base) => {
    expect(run(base, {}).success).toBe(true);
  });

  it('normalizes text, email and a scheme-less channel link', () => {
    const result = run(threeMonth, {
      name: '  Nguyễn Văn A ',
      email: '  A@Example.COM ',
      expertise: ' Dòng 1\r\nDòng 2 ',
      youtubeChannelUrl: '  youtube.com/@ten ',
    });
    expect(result).toMatchObject({
      success: true,
      data: {
        name: 'Nguyễn Văn A',
        email: 'a@example.com',
        expertise: 'Dòng 1\nDòng 2',
        youtubeChannelUrl: 'https://youtube.com/@ten',
      },
    });
  });

  it.each(['https://www.youtube.com/@ten', 'http://youtu.be/abc', 'https://m.youtube.com/c/x'])(
    'accepts the channel link %s as written',
    (url) => {
      expect(run(kickstart, { youtubeChannelUrl: url })).toMatchObject({
        success: true,
        data: { youtubeChannelUrl: url },
      });
    },
  );

  it.each([
    'javascript:alert(1)',
    'https://evil.example/@x',
    'https://youtube.com.evil.example/x',
    'ftp://youtube.com/x',
    'https://youtube.com@evil.example/x',
  ])('refuses the channel link %s', (url) => {
    expectError(kickstart, { youtubeChannelUrl: url }, 'youtubeChannelUrl', 'INVALID');
  });

  it('refuses a channel link longer than 500 characters', () => {
    expectError(
      kickstart,
      { youtubeChannelUrl: `https://youtube.com/${'a'.repeat(500)}` },
      'youtubeChannelUrl',
      'TOO_LONG',
    );
  });

  it('refuses a channel link with not_started', () => {
    expectError(
      threeMonth,
      { youtubeStage: 'not_started', youtubeChannelUrl: 'https://youtube.com/@ten' },
      'youtubeChannelUrl',
      'INVALID',
    );
  });

  it('accepts a blank channel link with either stage and skips the host check', () => {
    expect(run(kickstart, { youtubeChannelUrl: '   ' }).success).toBe(true);
    expect(run(kickstart, { youtubeStage: 'not_started', youtubeChannelUrl: '' }).success).toBe(
      true,
    );
  });

  it('refuses challengeOther without other', () => {
    expectError(kickstart, { challengeOther: 'Khác' }, 'challengeOther', 'INVALID');
    expectError(threeMonth, { challengeOther: 'Khác' }, 'challengeOther', 'INVALID');
  });

  it('counts a blank challengeOther as absent', () => {
    expect(run(kickstart, { challengeOther: '  ' }).success).toBe(true);
    expect(run(threeMonth, { challengeOther: '' }).success).toBe(true);
  });

  it('requires challengeOther on 3-month when other is chosen', () => {
    expectError(threeMonth, { challenges: ['other'] }, 'challengeOther', 'INVALID');
    expectError(
      threeMonth,
      { challenges: ['other'], challengeOther: '  ' },
      'challengeOther',
      'INVALID',
    );
    expect(run(threeMonth, { challenges: ['other'], challengeOther: 'Khác' }).success).toBe(true);
  });

  it('allows other without text on Kickstart', () => {
    expect(run(kickstart, { challenges: ['other'] }).success).toBe(true);
    expect(run(kickstart, { challenges: ['other'], challengeOther: '' }).success).toBe(true);
  });

  it('refuses a 3-month challenge on Kickstart', () => {
    expectError(kickstart, { challenges: ['unclear_direction'] }, 'challenges.0', 'INVALID');
  });

  it('refuses a Kickstart-only challenge on 3-month', () => {
    expectError(threeMonth, { challenges: ['videos_dont_show_value'] }, 'challenges.0', 'INVALID');
  });

  it('refuses desiredOutcome and practiceCommitment on Kickstart', () => {
    expectError(kickstart, { desiredOutcome: 'x' }, 'desiredOutcome', 'UNKNOWN_FIELD');
    expectError(kickstart, { practiceCommitment: 'unsure' }, 'practiceCommitment', 'UNKNOWN_FIELD');
  });

  it('requires desiredOutcome and practiceCommitment on 3-month', () => {
    expectError(threeMonth, { desiredOutcome: undefined }, 'desiredOutcome', 'REQUIRED');
    expectError(threeMonth, { practiceCommitment: undefined }, 'practiceCommitment', 'INVALID');
    expectError(threeMonth, { desiredOutcome: '  ' }, 'desiredOutcome', 'TOO_SHORT');
  });

  it('refuses an unknown program and a missing program', () => {
    expectError(kickstart, { program: 'other_program' }, 'program', 'INVALID');
    const missing = run(kickstart, { program: undefined });
    expect(missing.success).toBe(false);
    expect(errorsOf(missing)).toEqual([
      expect.objectContaining({ field: 'program', code: 'INVALID' }),
    ]);
  });

  it('refuses empty goals and challenges', () => {
    expectError(kickstart, { goals: [] }, 'goals', 'TOO_SHORT');
    expectError(kickstart, { challenges: [] }, 'challenges', 'TOO_SHORT');
  });

  it('refuses repeated goals and challenges', () => {
    expectError(kickstart, { goals: ['share_knowledge', 'share_knowledge'] }, 'goals', 'INVALID');
    expectError(
      threeMonth,
      { challenges: ['unclear_direction', 'unclear_direction'] },
      'challenges',
      'INVALID',
    );
  });

  it('refuses an unknown goal', () => {
    expectError(kickstart, { goals: ['world_domination'] }, 'goals.0', 'INVALID');
  });

  it('refuses consent false or missing', () => {
    expectError(kickstart, { consent: false }, 'consent', 'INVALID');
    expectError(kickstart, { consent: undefined }, 'consent', 'INVALID');
  });

  it('counts 5000 emoji as 5000 and refuses 5001', () => {
    expect(run(kickstart, { expertise: '😀'.repeat(5000) }).success).toBe(true);
    expectError(kickstart, { expertise: '😀'.repeat(5001) }, 'expertise', 'TOO_LONG');
  });

  it('keeps optional text blank-able and bounded', () => {
    expect(run(kickstart, { favoriteCreators: '   ' }).success).toBe(true);
    expectError(kickstart, { favoriteCreators: 'a'.repeat(2001) }, 'favoriteCreators', 'TOO_LONG');
  });

  it('refuses a blank required text', () => {
    expectError(kickstart, { expertise: '   ' }, 'expertise', 'TOO_SHORT');
  });

  it('refuses a NUL character', () => {
    expectError(kickstart, { expertise: 'a\u0000b' }, 'expertise', 'INVALID');
  });

  it('refuses an unknown key', () => {
    expectError(kickstart, { role: 'admin' }, 'role', 'UNKNOWN_FIELD');
  });

  it('requires a recaptcha token and keeps it as sent', () => {
    expectError(kickstart, { recaptchaToken: '' }, 'recaptchaToken', 'TOO_SHORT');
    expect(run(kickstart, { recaptchaToken: ' tok ' })).toMatchObject({
      data: { recaptchaToken: ' tok ' },
    });
  });
});
