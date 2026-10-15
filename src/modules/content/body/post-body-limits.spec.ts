import { checkPostBodyLimits, POST_BODY_LIMITS } from './post-body-limits.js';

/** A document whose deepest node sits at `depth` (doc = 0). */
const nested = (depth: number) => {
  let node: object = { type: 'paragraph' };
  for (let level = depth; level > 1; level--) node = { type: 'blockquote', content: [node] };
  return { type: 'doc', content: [node] };
};

const flat = (paragraphs: number) => ({
  type: 'doc',
  content: Array.from({ length: paragraphs }, () => ({ type: 'paragraph' })),
});

/** A document of exactly `bytes` UTF-8 bytes, padded with the 2-byte "ă". */
const ofBytes = (bytes: number) => {
  const shell = (text: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
  const overhead = Buffer.byteLength(JSON.stringify(shell('')), 'utf8');
  const remaining = bytes - overhead;
  const text = 'ă'.repeat(Math.floor(remaining / 2)) + 'a'.repeat(remaining % 2);
  const doc = shell(text);
  expect(Buffer.byteLength(JSON.stringify(doc), 'utf8')).toBe(bytes);
  return doc;
};

describe('checkPostBodyLimits', () => {
  it('ignores non-objects (the schema reports them)', () => {
    for (const value of ['x', 1, null, undefined]) expect(checkPostBodyLimits(value)).toEqual([]);
  });

  it(`accepts depth ${POST_BODY_LIMITS.maxDepth} and rejects one more`, () => {
    expect(checkPostBodyLimits(nested(POST_BODY_LIMITS.maxDepth))).toEqual([]);
    expect(checkPostBodyLimits(nested(POST_BODY_LIMITS.maxDepth + 1))).toEqual([
      { message: 'The document is nested too deeply.' },
    ]);
  });

  it(`accepts ${POST_BODY_LIMITS.maxNodes} nodes and rejects one more`, () => {
    // the doc itself counts as a node
    expect(checkPostBodyLimits(flat(POST_BODY_LIMITS.maxNodes - 1))).toEqual([]);
    expect(checkPostBodyLimits(flat(POST_BODY_LIMITS.maxNodes))).toEqual([
      { message: 'The document has too many nodes.' },
    ]);
  });

  it('measures size in UTF-8 bytes', () => {
    expect(checkPostBodyLimits(ofBytes(POST_BODY_LIMITS.maxBytes))).toEqual([]);
    expect(checkPostBodyLimits(ofBytes(POST_BODY_LIMITS.maxBytes + 1))).toEqual([
      { message: 'The document is too large.' },
    ]);
  });

  it('handles a 20 000-level document without overflowing the stack', () => {
    expect(() => checkPostBodyLimits(nested(20_000))).not.toThrow();
    expect(checkPostBodyLimits(nested(20_000))).toEqual([
      { message: 'The document is nested too deeply.' },
    ]);
  });

  // Deep nesting that never goes through a node's `content` (final review, Critical 1).
  const deepArray = (levels: number) => {
    let value: unknown = [];
    for (let i = 0; i < levels; i++) value = [value];
    return value;
  };
  const deepObject = (levels: number) => {
    let value: unknown = {};
    for (let i = 0; i < levels; i++) value = { a: value };
    return value;
  };

  it.each([
    ['arrays inside content', () => ({ type: 'doc', content: [deepArray(20_000)] })],
    ['a foreign key holding arrays', () => ({ type: 'doc', content: [], x: deepArray(20_000) })],
    [
      'objects inside attrs',
      () => ({ type: 'doc', content: [{ type: 'heading', attrs: { y: deepObject(20_000) } }] }),
    ],
    [
      'arrays inside marks',
      () => ({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'a', marks: deepArray(20_000) }] },
        ],
      }),
    ],
  ])('rejects deep nesting through %s without throwing', (_name, build) => {
    const value = build();
    expect(() => checkPostBodyLimits(value)).not.toThrow();
    expect(checkPostBodyLimits(value)).toEqual([{ message: 'The document is nested too deeply.' }]);
  });

  it('still accepts the deepest legitimate document (a link mark on the deepest text)', () => {
    let node: object = {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'a',
          marks: [{ type: 'link', attrs: { href: 'https://x.vn' } }],
        },
      ],
    };
    // paragraph at depth maxDepth - 1, its text at maxDepth
    for (let level = POST_BODY_LIMITS.maxDepth - 1; level > 1; level--) {
      node = { type: 'blockquote', content: [node] };
    }
    expect(checkPostBodyLimits({ type: 'doc', content: [node] })).toEqual([]);
  });
});
