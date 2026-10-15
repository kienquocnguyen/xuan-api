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
