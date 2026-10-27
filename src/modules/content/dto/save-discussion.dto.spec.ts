import { savePostCommentSchema, savePostRatingSchema } from './save-discussion.dto.js';

describe('discussion request schemas (blog completion spec §6.2)', () => {
  describe('SavePostCommentDto.body (Review Focus 2)', () => {
    const parse = (body: unknown) => savePostCommentSchema.safeParse({ body });

    it.each([
      ['trims and normalizes CRLF', '  a\r\nb  ', 'a\nb'],
      ['normalizes a lone CR', 'a\rb', 'a\nb'],
      ['keeps inner blank lines', 'a\n\nb', 'a\n\nb'],
    ])('%s', (_name, input, stored) => {
      expect(parse(input)).toMatchObject({ success: true, data: { body: stored } });
    });

    it('counts code points, so 2 000 emoji fit and 2 001 do not', () => {
      expect(parse('😀'.repeat(2000)).success).toBe(true);
      expect(parse('😀'.repeat(2001)).success).toBe(false);
      expect(parse('a'.repeat(2001)).success).toBe(false);
    });

    it.each([
      ['empty', ''],
      ['only whitespace and newlines', ' \r\n\t \n '],
      ['a NUL', 'a\u0000b'],
      ['a lone surrogate', 'a\ud800b'],
      ['not a string', 42],
    ])('refuses %s', (_name, input) => {
      expect(parse(input).success).toBe(false);
    });

    it('refuses unknown fields', () => {
      expect(savePostCommentSchema.safeParse({ body: 'a', extra: 1 }).success).toBe(false);
    });
  });

  it('takes whole ratings from 1 to 5 only', () => {
    expect([1, 5].map((value) => savePostRatingSchema.safeParse({ value }).success)).toEqual([
      true,
      true,
    ]);
    expect(
      [0, 6, 2.5, '4'].map((value) => savePostRatingSchema.safeParse({ value }).success),
    ).toEqual([false, false, false, false]);
  });
});
