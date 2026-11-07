import { canonicalQuery, signVnpay } from './vnpay-signature.js';

/** The four VNPAY settings (config, course sales spec §5.7). The secret is never logged (I5, I17). */
export type VnpaySettings = Readonly<{
  tmnCode: string;
  hashSecret: string;
  paymentUrl: string;
  returnUrl: string;
}>;

export type PayableOrder = Readonly<{
  reference: string;
  amountVnd: number;
  createdAt: Date;
  expiresAt: Date;
}>;

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const FALLBACK_IP = '127.0.0.1';

/** `yyyyMMddHHmmss` in GMT+7, whatever the server's time zone (Vercel runs in UTC). */
export function formatVnpayDate(at: Date): string {
  return new Date(at.getTime() + VIETNAM_OFFSET_MS)
    .toISOString()
    .slice(0, 19)
    .replace(/[-T:]/g, '');
}

/**
 * `vnp_IpAddr` must be 7–45 characters (techspec): IPv4-mapped IPv6 becomes plain IPv4, and anything too short
 * (local `::1`) or missing becomes loopback. `req.ip` is already the client behind TRUST_PROXY_HOPS (CF-8).
 */
export function normalizeClientIp(ip: string | null | undefined): string {
  const plain = ip?.startsWith('::ffff:') ? ip.slice(7) : ip;
  return plain && plain.length >= 7 && plain.length <= 45 ? plain : FALLBACK_IP;
}

/** The signed redirect to VNPAY's hosted page (techspec §2.5.3.1; course sales spec §5.5). No bank code: VNPAY's picker. */
export function buildPaymentUrl(
  settings: VnpaySettings,
  order: PayableOrder,
  clientIp: string,
): string {
  const params: Record<string, string> = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: settings.tmnCode,
    vnp_Amount: String(order.amountVnd * 100),
    vnp_CurrCode: 'VND',
    vnp_TxnRef: order.reference,
    // ASCII without diacritics (techspec); nothing here needs encoding beyond spaces.
    vnp_OrderInfo: `Thanh toan khoa hoc ${order.reference}`,
    vnp_OrderType: 'other',
    vnp_Locale: 'vn',
    vnp_ReturnUrl: settings.returnUrl,
    vnp_IpAddr: clientIp,
    vnp_CreateDate: formatVnpayDate(order.createdAt),
    vnp_ExpireDate: formatVnpayDate(order.expiresAt),
  };
  const query = canonicalQuery(params);
  return `${settings.paymentUrl}?${query}&vnp_SecureHash=${signVnpay(settings.hashSecret, params)}`;
}
