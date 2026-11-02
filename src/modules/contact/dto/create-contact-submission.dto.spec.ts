import { createContactSubmissionSchema } from './create-contact-submission.dto.js';

const valid = {
  name: 'Nguyễn Văn A',
  email: 'a@example.com',
  subject: 'general',
  message: 'Xin chào, mình muốn hợp tác.',
  recaptchaToken: 'token-1',
};

describe('CreateContactSubmissionDto (contact form design §4)', () => {
  const parse = (overrides: Record<string, unknown>) =>
    createContactSubmissionSchema.safeParse({ ...valid, ...overrides });

  it('normalizes name, email and message, and keeps the token as sent', () => {
    expect(
      parse({
        name: '  Nguyễn Văn A ',
        email: '  A.Person@Example.COM ',
        message: '  Dòng 1\r\nDòng 2\rDòng 3  ',
        recaptchaToken: ' tok ',
      }),
    ).toEqual({
      success: true,
      data: {
        name: 'Nguyễn Văn A',
        email: 'a.person@example.com',
        subject: 'general',
        message: 'Dòng 1\nDòng 2\nDòng 3',
        recaptchaToken: ' tok ',
      },
    });
  });

  it.each(['youtube_editing_course', 'channel_kickstart_session', 'youtube_coaching_3_months'])(
    'accepts the subject %s',
    (subject) => {
      expect(parse({ subject }).success).toBe(true);
    },
  );

  it('counts code points: 100-character names and 5 000-character messages fit', () => {
    expect(parse({ name: '😀'.repeat(100), message: '😀'.repeat(5000) }).success).toBe(true);
    expect(parse({ name: 'a'.repeat(101) }).success).toBe(false);
    expect(parse({ message: '😀'.repeat(5001) }).success).toBe(false);
  });

  it('needs at least 10 characters of message', () => {
    expect(parse({ message: '123456789' }).success).toBe(false);
    expect(parse({ message: '  1234567890  ' }).success).toBe(true);
  });

  it.each([
    ['a blank name', { name: '   ' }],
    ['a name with a line break', { name: 'A\nB' }],
    ['a name with a NUL', { name: 'A\u0000B' }],
    ['a name with a lone surrogate', { name: 'A\ud800' }],
    ['a blank message', { message: ' \n\t '.repeat(5) }],
    ['a message with a NUL', { message: 'Xin chào\u0000 bạn ơi' }],
    ['a malformed email', { email: 'not-an-email' }],
    ['an email over 254 characters', { email: `${'a'.repeat(64)}@${'b'.repeat(186)}.com` }],
    ['an unknown subject', { subject: 'pricing' }],
    ['a label instead of a subject', { subject: 'Liên hệ chung hoặc hợp tác' }],
    ['an empty token', { recaptchaToken: '' }],
    ['a token over 4 096 characters', { recaptchaToken: 't'.repeat(4097) }],
    ['a missing token', { recaptchaToken: undefined }],
    ['a number as message', { message: 1234567890 }],
  ])('refuses %s', (_name, overrides) => {
    expect(parse(overrides).success).toBe(false);
  });

  it('reports lengths as too_small / too_big, so the field codes are TOO_SHORT / TOO_LONG', () => {
    const codes = (overrides: Record<string, unknown>) =>
      parse(overrides).error?.issues.map((issue) => [issue.path.join('.'), issue.code]);
    expect(codes({ name: '  ' })).toEqual([['name', 'too_small']]);
    expect(codes({ name: 'a'.repeat(101) })).toEqual([['name', 'too_big']]);
    expect(codes({ message: ' \n ' })).toEqual([['message', 'too_small']]);
    expect(codes({ message: 'ngắn' })).toEqual([['message', 'too_small']]);
    expect(codes({ message: 'a'.repeat(5001) })).toEqual([['message', 'too_big']]);
  });

  it('refuses unknown fields (D8)', () => {
    expect(parse({ phone: '0900000000' }).success).toBe(false);
  });
});
