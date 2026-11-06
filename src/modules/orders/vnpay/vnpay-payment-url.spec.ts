import { buildPaymentUrl, formatVnpayDate, normalizeClientIp } from './vnpay-payment-url.js';
import { verifyVnpay } from './vnpay-signature.js';

const settings = {
  tmnCode: 'TESTTMN1',
  hashSecret: 'test-vnpay-secret',
  paymentUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
  returnUrl: 'http://localhost:3000/khoa-hoc/thanh-toan/ket-qua',
};
const order = {
  reference: '0123456789abcdef0123456789abcdef',
  amountVnd: 499_000,
  createdAt: new Date('2026-11-07T17:30:00.000Z'),
  expiresAt: new Date('2026-11-07T17:45:00.000Z'),
};

describe('formatVnpayDate (GMT+7)', () => {
  it.each([
    ['UTC morning', '2026-11-07T01:02:03.000Z', '20261107080203'],
    [
      'just before UTC midnight: already the next day in Vietnam',
      '2026-11-07T17:30:00.000Z',
      '20261108003000',
    ],
    ['New Year in Vietnam', '2026-12-31T17:00:00.000Z', '20270101000000'],
  ])('formats %s', (_case, iso, expected) => {
    expect(formatVnpayDate(new Date(iso))).toBe(expected);
  });
});

describe('normalizeClientIp', () => {
  it.each([
    ['an IPv4 address', '203.0.113.7', '203.0.113.7'],
    ['an IPv4-mapped IPv6 address', '::ffff:203.0.113.7', '203.0.113.7'],
    ['a full IPv6 address', '2001:db8::1234:5678', '2001:db8::1234:5678'],
    ['IPv6 loopback (too short for vnp_IpAddr)', '::1', '127.0.0.1'],
    ['no address', undefined, '127.0.0.1'],
    ['null', null, '127.0.0.1'],
  ])('maps %s', (_case, ip, expected) => {
    expect(normalizeClientIp(ip)).toBe(expected);
  });
});

describe('buildPaymentUrl (techspec §2.5.3.1)', () => {
  const url = new URL(buildPaymentUrl(settings, order, '203.0.113.7'));
  const params = Object.fromEntries(url.searchParams);

  it('targets the configured gateway', () => {
    expect(`${url.origin}${url.pathname}`).toBe(settings.paymentUrl);
  });

  it('sends exactly the agreed parameters', () => {
    expect(params).toEqual({
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: 'TESTTMN1',
      vnp_Amount: '49900000',
      vnp_CurrCode: 'VND',
      vnp_TxnRef: order.reference,
      vnp_OrderInfo: `Thanh toan khoa hoc ${order.reference}`,
      vnp_OrderType: 'other',
      vnp_Locale: 'vn',
      vnp_ReturnUrl: settings.returnUrl,
      vnp_IpAddr: '203.0.113.7',
      vnp_CreateDate: '20261108003000',
      vnp_ExpireDate: '20261108004500',
      vnp_SecureHash: expect.stringMatching(/^[0-9a-f]{128}$/),
    });
  });

  it('puts the hash last and signs what it sends', () => {
    expect(url.search).toMatch(/&vnp_SecureHash=[0-9a-f]{128}$/);
    expect(verifyVnpay(settings.hashSecret, params).valid).toBe(true);
  });
});
