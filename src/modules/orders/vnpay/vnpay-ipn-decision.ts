/** The `RspCode`s our IPN answers, with the exact messages VNPAY's SIT expects (course sales spec §5.6). */
export const IPN_MESSAGES = {
  '00': 'Confirm Success',
  '01': 'Order Not Found',
  '02': 'Order already confirmed',
  '04': 'Invalid amount',
  '97': 'Invalid Checksum',
  '99': 'Unknown error',
} as const;
export type IpnRspCode = keyof typeof IPN_MESSAGES;

export type IpnOrderState = Readonly<{ status: 'pending' | 'paid' | 'failed'; amountVnd: number }>;

/** `ack`: answer now, change nothing. `settle`: record the outcome, then answer `00`. */
export type IpnDecision =
  | Readonly<{ kind: 'ack'; rspCode: '01' | '02' | '04' }>
  | Readonly<{ kind: 'settle'; outcome: 'paid' | 'failed' }>;

/**
 * What a **signature-verified** IPN does to the locked order (spec §5.6), in VNPAY's check order: order, amount,
 * state. Success needs both codes `00`. Expiry plays no part (S9), and a success may settle a `failed` order (S14).
 */
export function decideIpn(
  order: IpnOrderState | null,
  params: Readonly<Record<string, string>>,
): IpnDecision {
  if (order === null) return { kind: 'ack', rspCode: '01' };
  const amount = params.vnp_Amount;
  if (
    amount === undefined ||
    !/^\d{1,15}$/.test(amount) ||
    Number(amount) !== order.amountVnd * 100
  ) {
    return { kind: 'ack', rspCode: '04' };
  }
  const success = params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00';
  if (order.status === 'paid' || (order.status === 'failed' && !success)) {
    return { kind: 'ack', rspCode: '02' };
  }
  return { kind: 'settle', outcome: success ? 'paid' : 'failed' };
}
