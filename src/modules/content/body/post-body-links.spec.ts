import { isSafeLinkHref } from './post-body-links.js';

describe('isSafeLinkHref (spec §4.1 link rule)', () => {
  it.each([
    'https://xuancreative.com/a?b=1#c',
    'http://example.vn',
    'HTTPS://EXAMPLE.VN',
    'mailto:hello@example.vn',
  ])('accepts %s', (href) => {
    expect(isSafeLinkHref(href)).toBe(true);
  });

  it.each([
    ['javascript', 'javascript:alert(1)'],
    ['javascript, upper case', 'JAVASCRIPT:alert(1)'],
    ['data', 'data:text/html,<b>x</b>'],
    ['vbscript', 'vbscript:msgbox(1)'],
    ['ftp', 'ftp://example.vn/file'],
    ['relative path', '/bai-viet'],
    ['protocol-relative', '//evil.example'],
    ['fragment only', '#top'],
    ['credentials', 'https://user:pw@example.vn'],
    ['username only', 'https://user@example.vn'],
    ['space', 'https://example.vn/a b'],
    ['leading space', ' https://example.vn'],
    ['tab', 'https://example.vn/\t'],
    ['newline', 'https://example.vn/\n'],
    ['NUL', 'https://example.vn/\u0000'],
    ['DEL', 'https://example.vn/\u007f'],
    ['empty', ''],
  ])('rejects %s', (_name, href) => {
    expect(isSafeLinkHref(href)).toBe(false);
  });
});
