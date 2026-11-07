import { createHmac } from 'node:crypto';
import { canonicalQuery, signVnpay, verifyVnpay } from './vnpay-signature.js';

const SECRET = 'test-vnpay-secret';
const hmac = (data: string) => createHmac('sha512', SECRET).update(data, 'utf8').digest('hex');

/** What Express hands the IPN handler: the query string parsed into an object (`+` and `%20` → space). */
const parsedQuery = (url: string) => Object.fromEntries(new URL(url).searchParams);

describe('canonicalQuery (course sales spec S8)', () => {
  it('sorts keys, skips empty values and joins k=v with &', () => {
    expect(canonicalQuery({ vnp_b: '2', vnp_a: '1', vnp_c: '' })).toBe('vnp_a=1&vnp_b=2');
  });

  it('URL-encodes like PHP urlencode: space as +, reserved characters percent-encoded', () => {
    expect(
      canonicalQuery({
        vnp_OrderInfo: 'Thanh toan khoa hoc abc',
        vnp_ReturnUrl: 'https://xuancreative.com/a?b=c',
        vnp_X: "!'()*~",
      }),
    ).toBe(
      'vnp_OrderInfo=Thanh+toan+khoa+hoc+abc' +
        '&vnp_ReturnUrl=https%3A%2F%2Fxuancreative.com%2Fa%3Fb%3Dc' +
        '&vnp_X=%21%27%28%29%2A%7E',
    );
  });
});

describe('signVnpay', () => {
  it('is the lowercase hex HMAC-SHA512 of the canonical query', () => {
    expect(signVnpay(SECRET, { vnp_TxnRef: 'abc', vnp_Amount: '49900000' })).toBe(
      hmac('vnp_Amount=49900000&vnp_TxnRef=abc'),
    );
  });
});

describe('verifyVnpay', () => {
  const params = {
    vnp_Amount: '49900000',
    vnp_OrderInfo: 'Thanh toan khoa hoc 0123456789abcdef0123456789abcdef',
    vnp_ResponseCode: '00',
    vnp_TransactionStatus: '00',
    vnp_TxnRef: '0123456789abcdef0123456789abcdef',
  };
  const signedUrl = (extra: Record<string, string> = {}) => {
    const all = { ...params, ...extra };
    return `https://api.test/ipn?${canonicalQuery(all)}&vnp_SecureHashType=HmacSHA512&vnp_SecureHash=${signVnpay(SECRET, all)}`;
  };

  it('accepts what signVnpay produced after query parsing, excluding the hash fields', () => {
    expect(verifyVnpay(SECRET, parsedQuery(signedUrl()))).toEqual({ valid: true, params });
  });

  it('accepts an uppercase hash', () => {
    const query = parsedQuery(signedUrl());
    query.vnp_SecureHash = query.vnp_SecureHash.toUpperCase();
    expect(verifyVnpay(SECRET, query).valid).toBe(true);
  });

  it('ignores keys that are not vnp_ parameters', () => {
    expect(verifyVnpay(SECRET, { ...parsedQuery(signedUrl()), utm_source: 'x' }).valid).toBe(true);
  });

  it.each([
    ['a changed amount', (q: Record<string, unknown>) => ({ ...q, vnp_Amount: '49900001' })],
    ['an added parameter', (q: Record<string, unknown>) => ({ ...q, vnp_Extra: '1' })],
    ['a missing hash', (q: Record<string, unknown>) => ({ ...q, vnp_SecureHash: undefined })],
    ['an empty hash', (q: Record<string, unknown>) => ({ ...q, vnp_SecureHash: '' })],
    ['a short hash', (q: Record<string, unknown>) => ({ ...q, vnp_SecureHash: 'abc' })],
    ['a repeated key (array)', (q: Record<string, unknown>) => ({ ...q, vnp_Amount: ['1', '2'] })],
    ['an object value', (q: Record<string, unknown>) => ({ ...q, vnp_TxnRef: { a: '1' } })],
  ])('rejects %s', (_case, tamper) => {
    expect(verifyVnpay(SECRET, tamper(parsedQuery(signedUrl())))).toEqual({ valid: false });
  });

  it('rejects a signature made with another secret (SIT case 6)', () => {
    const forged = parsedQuery(signedUrl());
    forged.vnp_SecureHash = signVnpay('another-secret', params);
    expect(verifyVnpay(SECRET, forged)).toEqual({ valid: false });
  });
});
