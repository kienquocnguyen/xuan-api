import { postBodyInputSchema } from './post-body.schema.js';

const text = (t: string, marks?: unknown[]) => ({
  type: 'text',
  text: t,
  ...(marks ? { marks } : {}),
});
const p = (...content: unknown[]) =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const item = (...content: unknown[]) => ({ type: 'listItem', content });
/** What TipTap 3.28's link extension emits by default. */
const tiptapLink = (href: string) => ({
  type: 'link',
  attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow', class: null, title: null },
});
const link = (attrs: Record<string, unknown>) => ({ type: 'link', attrs });
const withMark = (mark: unknown) => doc(p(text('a', [mark])));

const parse = (value: unknown) => postBodyInputSchema.safeParse(value);
const pathsOf = (value: unknown) => {
  const result = parse(value);
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
};

describe('postBodyInputSchema: version-1 allow-list (spec §4.1)', () => {
  it.each([
    ['an empty document', doc()],
    ['an empty paragraph (no content key)', doc(p())],
    [
      'bold, italic and a TipTap default link',
      doc(p(text('a', [{ type: 'bold' }, { type: 'italic' }, tiptapLink('https://x.vn')]))),
    ],
    ['a minimal link', withMark(link({ href: 'mailto:a@b.vn' }))],
    ['link default attrs as null', withMark(link({ href: 'http://x', target: null, rel: null }))],
    ['heading level 2', doc({ type: 'heading', attrs: { level: 2 }, content: [text('a')] })],
    ['heading level 3 without content', doc({ type: 'heading', attrs: { level: 3 } })],
    [
      'a bullet list with a nested list',
      doc({
        type: 'bulletList',
        content: [item(p(text('a')), { type: 'bulletList', content: [item(p())] })],
      }),
    ],
    [
      'an ordered list with TipTap attrs',
      doc({ type: 'orderedList', attrs: { start: 1, type: null }, content: [item(p(text('a')))] }),
    ],
    ['an ordered list without attrs', doc({ type: 'orderedList', content: [item(p())] })],
    [
      'an ordered list starting at 5',
      doc({ type: 'orderedList', attrs: { start: 5 }, content: [item(p())] }),
    ],
    ['a blockquote', doc({ type: 'blockquote', content: [p(text('q'))] })],
    [
      'hard breaks with and without marks',
      doc(p(text('a'), { type: 'hardBreak' }, { type: 'hardBreak', marks: [{ type: 'bold' }] })),
    ],
    ['Vietnamese text', doc(p(text('Xin chào, đây là bài viết đầu tiên.')))],
  ])('accepts %s', (_name, value) => {
    expect(parse(value).success).toBe(true);
  });

  it.each([
    ['a non-object body', 'x'],
    ['an array body', []],
    ['a null body', null],
    ['a doc without content', { type: 'doc' }],
    ['a non-doc root', { type: 'paragraph' }],
    [
      'heading level 1 (the page title is the h1)',
      doc({ type: 'heading', attrs: { level: 1 }, content: [text('a')] }),
    ],
    ['heading level 4', doc({ type: 'heading', attrs: { level: 4 } })],
    ['a heading without attrs', doc({ type: 'heading', content: [text('a')] })],
    [
      'an image node (no images in v1)',
      doc({ type: 'image', attrs: { src: 'https://x.vn/a.png' } }),
    ],
    ['an unknown node', doc({ type: 'codeBlock', content: [text('x')] })],
    ['an unknown mark', withMark({ type: 'underline' })],
    ['an extra key on a paragraph', doc({ type: 'paragraph', attrs: {} })],
    ['an extra key on a text node', doc(p({ type: 'text', text: 'a', style: 'x' }))],
    ['attrs on bold', withMark({ type: 'bold', attrs: {} })],
    ['a javascript: link', withMark(link({ href: 'javascript:alert(1)' }))],
    ['a JAVASCRIPT: link', withMark(link({ href: 'JAVASCRIPT:x' }))],
    ['a data: link', withMark(link({ href: 'data:text/html,x' }))],
    ['a relative link', withMark(link({ href: '/relative' }))],
    ['a protocol-relative link', withMark(link({ href: '//evil.example' }))],
    ['a fragment link', withMark(link({ href: '#top' }))],
    ['a link with credentials', withMark(link({ href: 'https://u:p@x.vn' }))],
    ['a 2 049-char link', withMark(link({ href: `https://x.vn/${'a'.repeat(2049 - 13)}` }))],
    ['a link without href', withMark(link({ target: '_blank' }))],
    ['target _self', withMark(link({ href: 'https://x.vn', target: '_self' }))],
    ['a custom rel', withMark(link({ href: 'https://x.vn', rel: 'noopener' }))],
    ['a class', withMark(link({ href: 'https://x.vn', class: 'x' }))],
    ['a title string', withMark(link({ href: 'https://x.vn', title: 'x' }))],
    ['an extra link attr', withMark(link({ href: 'https://x.vn', foo: 1 }))],
    ['a duplicated mark', doc(p(text('a', [{ type: 'bold' }, { type: 'bold' }])))],
    ['an empty text node', doc(p(text('')))],
    ['a NUL in text', doc(p(text('a\u0000b')))],
    ['a lone high surrogate in text', doc(p(text('a\ud800b')))],
    ['a lone low surrogate in text', doc(p(text('\udc00')))],
    ['a lone surrogate in a link', withMark(link({ href: 'https://x.vn/\ud800' }))],
    ['a 10 001-char text node', doc(p(text('a'.repeat(10_001))))],
    [
      'a list item starting with a heading',
      doc({ type: 'bulletList', content: [item({ type: 'heading', attrs: { level: 2 } })] }),
    ],
    ['an empty list item', doc({ type: 'bulletList', content: [item()] })],
    ['an empty bullet list', doc({ type: 'bulletList', content: [] })],
    ['an empty blockquote', doc({ type: 'blockquote', content: [] })],
    ['text directly inside a blockquote', doc({ type: 'blockquote', content: [text('x')] })],
    [
      'ordered list start 0',
      doc({ type: 'orderedList', attrs: { start: 0 }, content: [item(p())] }),
    ],
    [
      'ordered list type "a"',
      doc({ type: 'orderedList', attrs: { start: 1, type: 'a' }, content: [item(p())] }),
    ],
    ['a paragraph inside a paragraph', doc(p(p()))],
  ])('rejects %s', (_name, value) => {
    expect(parse(value).success).toBe(false);
  });

  it('reports the path of the offending value', () => {
    expect(pathsOf(doc(p(text('a')), p(text('b', [link({ href: 'javascript:x' })]))))).toEqual([
      'content.1.content.0.marks.0.attrs.href',
    ]);
    expect(pathsOf(doc({ type: 'heading', attrs: { level: 1 } }))).toEqual([
      'content.0.attrs.level',
    ]);
  });

  it('answers a 20 000-level document with an issue instead of overflowing the stack', () => {
    let node: object = { type: 'paragraph' };
    for (let i = 0; i < 20_000; i++) node = { type: 'blockquote', content: [node] };
    const result = parse(doc(node));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toEqual([
      'The document is nested too deeply.',
    ]);
  });
});
