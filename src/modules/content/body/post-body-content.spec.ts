import { canonicalizePostBody, hasMeaningfulText } from './post-body-content.js';
import type { PostBodyDocument, PostBodyInline, PostBodyNode } from './post-body.schema.js';

const text = (t: string): PostBodyInline => ({ type: 'text', text: t });
const p = (...content: PostBodyInline[]): PostBodyNode =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
const doc = (...content: PostBodyNode[]): PostBodyDocument => ({ type: 'doc', content });

describe('hasMeaningfulText (spec B18)', () => {
  it.each([
    ['an empty document', doc()],
    ['an empty paragraph', doc(p())],
    ['an empty heading', doc({ type: 'heading', attrs: { level: 2 } })],
    ['spaces only', doc(p(text('   ')))],
    ['no-break space, tab and newline', doc(p(text(' \t\n')))],
    ['hard breaks only', doc(p({ type: 'hardBreak' }, { type: 'hardBreak' }))],
  ])('is false for %s', (_name, body) => {
    expect(hasMeaningfulText(body)).toBe(false);
  });

  it.each([
    ['a padded word', doc(p(text('  a  ')))],
    ['a heading', doc({ type: 'heading', attrs: { level: 3 }, content: [text('Tiêu đề')] })],
    [
      'text deep inside a list in a quote',
      doc({
        type: 'blockquote',
        content: [
          {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [p(text(' '), text('x'))] }],
          },
        ],
      }),
    ],
  ])('is true for %s', (_name, body) => {
    expect(hasMeaningfulText(body)).toBe(true);
  });
});

describe('canonicalizePostBody (spec §4.1 canonical storage)', () => {
  it('keeps only href on links and leaves everything else untouched', () => {
    const input = doc(
      {
        type: 'orderedList',
        attrs: { start: 3, type: null },
        content: [
          {
            type: 'listItem',
            content: [
              p(
                {
                  type: 'text',
                  text: 'a',
                  marks: [
                    { type: 'bold' },
                    {
                      type: 'link',
                      attrs: {
                        href: 'https://x.vn',
                        target: '_blank',
                        rel: 'noopener noreferrer nofollow',
                        class: null,
                        title: null,
                      },
                    },
                  ],
                },
                { type: 'hardBreak' },
              ),
            ],
          },
        ],
      },
      { type: 'heading', attrs: { level: 2 }, content: [text('b')] },
    );
    expect(canonicalizePostBody(input)).toEqual(
      doc(
        {
          type: 'orderedList',
          attrs: { start: 3, type: null },
          content: [
            {
              type: 'listItem',
              content: [
                p(
                  {
                    type: 'text',
                    text: 'a',
                    marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://x.vn' } }],
                  },
                  { type: 'hardBreak' },
                ),
              ],
            },
          ],
        },
        { type: 'heading', attrs: { level: 2 }, content: [text('b')] },
      ),
    );
  });

  it('does not mutate its input', () => {
    const link = {
      type: 'link' as const,
      attrs: { href: 'https://x.vn', target: '_blank' as const },
    };
    const input = doc(p({ type: 'text', text: 'a', marks: [link] }));
    canonicalizePostBody(input);
    expect(link.attrs.target).toBe('_blank');
  });
});
