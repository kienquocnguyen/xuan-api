import { savePostSchema } from './save-post.dto.js';

const body = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
};
const input = (overrides: Record<string, unknown> = {}) => ({
  slug: 'bai-viet',
  title: 'Bài',
  body,
  ...overrides,
});

describe('savePostSchema strings (final review, Important 2)', () => {
  it('accepts well-formed text, including astral characters (emoji)', () => {
    expect(savePostSchema.safeParse(input({ title: 'Bài 🎬', excerpt: '✨ ok' })).success).toBe(
      true,
    );
  });

  it.each([
    ['title', { title: 'a\ud800' }],
    ['excerpt', { excerpt: '\udc00b' }],
    ['seoTitle', { seoTitle: 'x\ud83d' }],
    ['seoDescription', { seoDescription: 'a\u0000' }],
  ])('rejects a lone surrogate or NUL in %s', (field, overrides) => {
    const result = savePostSchema.safeParse(input(overrides));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([field]);
  });
});

describe('savePostSchema tags (blog B1)', () => {
  const issuesOf = (tags: unknown) =>
    savePostSchema
      .safeParse(input({ tags }))
      .error?.issues.map((issue) => `${issue.path.join('.')}:${issue.code}`);

  it('trims tags and keeps their order and case', () => {
    expect(savePostSchema.parse(input({ tags: ['  Đà Lạt ', 'GoPro', 'ảnh'] })).tags).toEqual([
      'Đà Lạt',
      'GoPro',
      'ảnh',
    ]);
  });

  it('rejects an 11th tag', () => {
    expect(issuesOf(Array.from({ length: 11 }, (_, i) => `t${i}`))).toEqual(['tags:too_big']);
  });

  it.each([
    ['blank', '   ', 'tags.1:too_small'],
    ['41 characters', 'x'.repeat(41), 'tags.1:too_big'],
    ['a comma', 'a,b', 'tags.1:custom'],
    ['a NUL', 'a\u0000', 'tags.1:custom'],
    ['a lone surrogate', 'a\ud800', 'tags.1:custom'],
  ])('rejects a tag with %s', (_label, tag, issue) => {
    expect(issuesOf(['ok', tag])).toEqual([issue]);
  });

  it('rejects case-insensitive and Unicode-equivalent duplicates at the later position', () => {
    expect(issuesOf(['Đà Lạt', 'đà lạt'])).toEqual(['tags.1:custom']);
    expect(issuesOf(['café', 'x', 'café'])).toEqual(['tags.2:custom']); // NFC vs NFD
  });

  it('stores decomposed (NFD) Vietnamese as NFC and measures length after normalizing (review)', () => {
    const nfd = 'Thành phố Hồ Chí Minh về đêm rực rỡ'.normalize('NFD');
    expect(nfd.length).toBeGreaterThan(40); // 34 letters, more than 40 UTF-16 units decomposed
    expect(savePostSchema.parse(input({ tags: [nfd] })).tags).toEqual([nfd.normalize('NFC')]);
  });

  it('keeps null and omitted tags distinct, so an omission can be detected', () => {
    expect(savePostSchema.parse(input({ tags: null })).tags).toBeNull();
    expect('tags' in savePostSchema.parse(input())).toBe(false);
  });
});
