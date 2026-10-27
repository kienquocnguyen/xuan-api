import { collectMediaSources, fitsBodyVersion1, hasIncompleteMedia } from './post-body-content.js';
import { postBodyDocumentSchema } from './post-body.schema.js';

const SRC = 'http://localhost:4000/media/blog/0190f2a4-0000-7000-8000-000000000000-1280.webp';
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (t: string, marks?: unknown[]) => ({
  type: 'text',
  text: t,
  ...(marks ? { marks } : {}),
});
const image = (attrs: Record<string, unknown> = {}) => ({
  type: 'image',
  attrs: { src: SRC, alt: 'Ảnh', title: null, width: 1280, height: 720, ...attrs },
});
const beforeAfter = (attrs: Record<string, unknown> = {}) => ({
  type: 'beforeAfter',
  attrs: {
    before: SRC,
    after: SRC,
    beforeAlt: 'Trước',
    afterAlt: 'Sau',
    caption: '',
    initial: 50,
    width: 1600,
    height: 900,
    ...attrs,
  },
});
const ok = (value: unknown) => postBodyDocumentSchema.safeParse(value).success;
const paths = (value: unknown) =>
  postBodyDocumentSchema.safeParse(value).error?.issues.map((issue) => issue.path.join('.'));

describe('body version 2 (blog completion spec §5.5)', () => {
  it.each([
    ['an image', doc(image())],
    [
      'an image without a title key',
      doc({ type: 'image', attrs: { src: SRC, alt: 'a', width: 1, height: 1 } }),
    ],
    ['a before/after block', doc(beforeAfter())],
    ['an unfinished before/after block', doc(beforeAfter({ before: '' }))],
    ['a horizontal rule', doc({ type: 'horizontalRule' })],
    [
      'a code block',
      doc({
        type: 'codeBlock',
        attrs: { language: 'typescript' },
        content: [text('const a = 1;')],
      }),
    ],
    [
      'an empty code block without a language',
      doc({ type: 'codeBlock', attrs: { language: null } }),
    ],
    [
      'a YouTube embed',
      doc({ type: 'videoEmbed', attrs: { provider: 'youtube', videoId: 'dQw4w9WgXcQ' } }),
    ],
    [
      'a Vimeo embed',
      doc({ type: 'videoEmbed', attrs: { provider: 'vimeo', videoId: '76979871' } }),
    ],
    [
      'underline, strike and code marks',
      doc(p(text('x', [{ type: 'underline' }, { type: 'strike' }, { type: 'code' }]))),
    ],
    ['a site-relative link', doc(p(text('x', [{ type: 'link', attrs: { href: '/dich-vu' } }])))],
    ['an anchor link', doc(p(text('x', [{ type: 'link', attrs: { href: '#cai-dat' } }])))],
    [
      'blocks inside quotes and list items',
      doc(
        { type: 'blockquote', content: [image()] },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [p(text('a')), { type: 'horizontalRule' }] }],
        },
      ),
    ],
  ])('accepts %s', (_name, value) => {
    expect(ok(value)).toBe(true);
  });

  it.each([
    ['an image with an extra attribute', doc(image({ class: 'x' })), 'content.0.attrs'],
    ['an image without alt text', doc(image({ alt: '  ' })), 'content.0.attrs.alt'],
    ['an image 7000 px wide', doc(image({ width: 7000 })), 'content.0.attrs.width'],
    ['a before/after start of 101', doc(beforeAfter({ initial: 101 })), 'content.0.attrs.initial'],
    [
      'a code block with a mark',
      doc({ type: 'codeBlock', content: [text('x', [{ type: 'bold' }])] }),
      'content.0.content.0',
    ],
    [
      'an unknown code language',
      doc({ type: 'codeBlock', attrs: { language: 'cobol' } }),
      'content.0.attrs.language',
    ],
    [
      'code inside a link',
      doc(p(text('x', [{ type: 'code' }, { type: 'link', attrs: { href: '/a' } }]))),
      'content.0.content.0.marks',
    ],
    [
      'a YouTube URL instead of an id',
      doc({
        type: 'videoEmbed',
        attrs: { provider: 'youtube', videoId: 'https://youtu.be/dQw4w9WgXcQ' },
      }),
      'content.0.attrs.videoId',
    ],
    [
      'a Vimeo id with letters',
      doc({ type: 'videoEmbed', attrs: { provider: 'vimeo', videoId: 'abc' } }),
      'content.0.attrs.videoId',
    ],
    [
      'an iframe',
      doc({ type: 'iframe', attrs: { src: 'https://evil.example' } }),
      'content.0.type',
    ],
    [
      'a protocol-relative link',
      doc(p(text('x', [{ type: 'link', attrs: { href: '//evil.example' } }]))),
      'content.0.content.0.marks.0.attrs.href',
    ],
    [
      'an anchor with a space',
      doc(p(text('x', [{ type: 'link', attrs: { href: '#a b' } }]))),
      'content.0.content.0.marks.0.attrs.href',
    ],
    [
      'a javascript: link',
      doc(p(text('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))),
      'content.0.content.0.marks.0.attrs.href',
    ],
  ])('rejects %s', (_name, value, path) => {
    expect(paths(value)?.[0]).toContain(path);
  });

  it('says whether a document fits version 1', () => {
    expect(fitsBodyVersion1(doc(p(text('chỉ chữ'))) as never)).toBe(true);
    expect(fitsBodyVersion1(doc(p(text('x', [{ type: 'underline' }]))) as never)).toBe(false);
    expect(fitsBodyVersion1(doc(image()) as never)).toBe(false);
  });

  it('finds every media source with its path, skipping unfinished halves', () => {
    const body = doc(
      p(text('a')),
      { type: 'blockquote', content: [image()] },
      beforeAfter({ after: '' }),
    );
    expect(collectMediaSources(body as never)).toEqual([
      { path: 'body.content.1.content.0.attrs.src', src: SRC },
      { path: 'body.content.2.attrs.before', src: SRC },
    ]);
  });

  it('spots an unfinished before/after block at any depth', () => {
    expect(hasIncompleteMedia(doc(beforeAfter()) as never)).toBe(false);
    expect(
      hasIncompleteMedia(
        doc({ type: 'blockquote', content: [beforeAfter({ after: '' })] }) as never,
      ),
    ).toBe(true);
  });
});
