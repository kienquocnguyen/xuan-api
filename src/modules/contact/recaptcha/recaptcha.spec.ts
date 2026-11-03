import { GoogleRecaptchaVerifier } from './google-recaptcha-verifier.js';
import {
  assessRecaptcha,
  RECAPTCHA_ACTION,
  RecaptchaUnavailableError,
  type SiteVerifyResult,
} from './recaptcha.js';

const now = new Date('2026-11-03T10:00:00.000Z');
const policy = { allowedHostnames: ['xuancreative.com', 'www.xuancreative.com'], minScore: 0.5 };
const passing: SiteVerifyResult = {
  success: true,
  score: 0.9,
  action: RECAPTCHA_ACTION,
  hostname: 'xuancreative.com',
  challengeTs: '2026-11-03T09:59:30Z',
  errorCodes: [],
};

describe('assessRecaptcha (contact form design CF-4)', () => {
  it('passes a successful, fresh, human-scored token for our action and host', () => {
    expect(assessRecaptcha(passing, policy, now)).toBe('pass');
    expect(assessRecaptcha({ ...passing, score: 0.5 }, policy, now)).toBe('pass');
    expect(assessRecaptcha({ ...passing, hostname: 'WWW.xuancreative.com' }, policy, now)).toBe(
      'pass',
    );
  });

  it.each([
    [
      'not_successful',
      { ...passing, success: false, errorCodes: ['timeout-or-duplicate'] } as SiteVerifyResult,
    ],
    ['wrong_action', { ...passing, action: 'login' }],
    ['wrong_action', { ...passing, action: undefined }],
    ['wrong_hostname', { ...passing, hostname: 'evil.example' }],
    ['wrong_hostname', { ...passing, hostname: undefined }],
    ['low_score', { ...passing, score: 0.49 }],
    ['low_score', { ...passing, score: undefined }],
    ['stale_challenge', { ...passing, challengeTs: '2026-11-03T09:56:59Z' }],
    ['stale_challenge', { ...passing, challengeTs: '2026-11-03T10:01:01Z' }],
    ['stale_challenge', { ...passing, challengeTs: 'yesterday' }],
    ['stale_challenge', { ...passing, challengeTs: undefined }],
  ])('refuses with %s', (reason, result) => {
    expect(assessRecaptcha(result as SiteVerifyResult, policy, now)).toBe(reason);
  });
});

describe('GoogleRecaptchaVerifier', () => {
  const respond = (status: number, body: unknown) =>
    vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it("posts the secret, token and client IP to Google's siteverify as a form", async () => {
    const fetchFn = respond(200, {
      success: true,
      score: 0.7,
      action: 'contact_submit',
      hostname: 'xuancreative.com',
      challenge_ts: '2026-11-03T09:59:30Z',
    });
    const result = await new GoogleRecaptchaVerifier('s3cret', fetchFn).verify(
      'tok',
      '203.0.113.9',
    );

    expect(result).toEqual({
      success: true,
      score: 0.7,
      action: 'contact_submit',
      hostname: 'xuancreative.com',
      challengeTs: '2026-11-03T09:59:30Z',
      errorCodes: [],
    });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://www.google.com/recaptcha/api/siteverify');
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(new URLSearchParams(init?.body as string))).toEqual({
      secret: 's3cret',
      response: 'tok',
      remoteip: '203.0.113.9',
    });
  });

  it('omits an unknown client IP and passes on error codes', async () => {
    const fetchFn = respond(200, { success: false, 'error-codes': ['invalid-input-response'] });
    const result = await new GoogleRecaptchaVerifier('s', fetchFn).verify('tok', null);
    expect(result).toMatchObject({ success: false, errorCodes: ['invalid-input-response'] });
    expect(new URLSearchParams(fetchFn.mock.calls[0][1]?.body as string).has('remoteip')).toBe(
      false,
    );
  });

  it.each([
    ['a network failure', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'))],
    ['a 5xx answer', respond(503, {})],
    [
      'a body that is not JSON',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>', { status: 200 })),
    ],
    ['a body without success', respond(200, { score: 1 })],
  ])('reports %s as unavailable, never as a pass', async (_name, fetchFn) => {
    await expect(new GoogleRecaptchaVerifier('s', fetchFn).verify('tok', null)).rejects.toThrow(
      RecaptchaUnavailableError,
    );
  });

  it('gives up after its timeout', async () => {
    const hanging = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
        ),
    );
    await expect(new GoogleRecaptchaVerifier('s', hanging, 20).verify('t', null)).rejects.toThrow(
      RecaptchaUnavailableError,
    );
  });
});
