import { decideIpn, IPN_MESSAGES } from './vnpay-ipn-decision.js';

const pending = {
  status: 'pending' as const,
  amountVnd: 499_000,
  expiresAt: new Date('2026-11-07T17:45:00.000Z'),
};
const ipn = (overrides: Record<string, string> = {}) => ({
  vnp_TxnRef: '0123456789abcdef0123456789abcdef',
  vnp_Amount: '49900000',
  vnp_ResponseCode: '00',
  vnp_TransactionStatus: '00',
  ...overrides,
});

describe('decideIpn (course sales spec §5.6, SIT cases 1–6)', () => {
  it.each([
    ['an unknown order (SIT 3)', null, ipn(), { kind: 'ack', rspCode: '01' }],
    [
      'a tampered amount (SIT 5)',
      pending,
      ipn({ vnp_Amount: '49900001' }),
      { kind: 'ack', rspCode: '04' },
    ],
    [
      'an amount that is not digits',
      pending,
      ipn({ vnp_Amount: '4990000O' }),
      { kind: 'ack', rspCode: '04' },
    ],
    [
      'a missing amount',
      pending,
      { vnp_TxnRef: 'x', vnp_ResponseCode: '00' },
      { kind: 'ack', rspCode: '04' },
    ],
    [
      'the amount in VND instead of ×100',
      pending,
      ipn({ vnp_Amount: '499000' }),
      { kind: 'ack', rspCode: '04' },
    ],
    [
      'a paid order replayed (SIT 4)',
      { ...pending, status: 'paid' as const },
      ipn(),
      { kind: 'ack', rspCode: '02' },
    ],
    [
      'a failure for an already failed order',
      { ...pending, status: 'failed' as const },
      ipn({ vnp_ResponseCode: '24', vnp_TransactionStatus: '02' }),
      { kind: 'ack', rspCode: '02' },
    ],
    [
      'a failure for a paid order',
      { ...pending, status: 'paid' as const },
      ipn({ vnp_ResponseCode: '24', vnp_TransactionStatus: '02' }),
      { kind: 'ack', rspCode: '02' },
    ],
    ['a success (SIT 1)', pending, ipn(), { kind: 'settle', outcome: 'paid' }],
    [
      'a success after a recorded failure (S14)',
      { ...pending, status: 'failed' as const },
      ipn(),
      { kind: 'settle', outcome: 'paid' },
    ],
    [
      'a cancelled payment (SIT 2)',
      pending,
      ipn({ vnp_ResponseCode: '24', vnp_TransactionStatus: '02' }),
      { kind: 'settle', outcome: 'failed' },
    ],
    [
      'response 00 with an unfinished transaction status',
      pending,
      ipn({ vnp_TransactionStatus: '01' }),
      { kind: 'settle', outcome: 'failed' },
    ],
    [
      'a suspicious transaction (07)',
      pending,
      ipn({ vnp_ResponseCode: '07', vnp_TransactionStatus: '07' }),
      { kind: 'settle', outcome: 'failed' },
    ],
    [
      'a missing response code',
      pending,
      { vnp_TxnRef: 'x', vnp_Amount: '49900000' },
      { kind: 'settle', outcome: 'failed' },
    ],
  ])('decides %s', (_case, order, params, expected) => {
    expect(decideIpn(order, params)).toEqual(expected);
  });

  it('honours a success that arrives after the order expired (S9)', () => {
    // The order row carries expires_at; the decision must ignore it.
    const expired = { ...pending, expiresAt: new Date('2000-01-01T00:00:00Z') };
    expect(decideIpn(expired, ipn())).toEqual({
      kind: 'settle',
      outcome: 'paid',
    });
  });

  it('answers with the exact messages the SIT expects', () => {
    expect(IPN_MESSAGES).toEqual({
      '00': 'Confirm Success',
      '01': 'Order Not Found',
      '02': 'Order already confirmed',
      '04': 'Invalid amount',
      '97': 'Invalid Checksum',
      '99': 'Unknown error',
    });
  });
});
