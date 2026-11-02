import type { AppConfig } from '../../../config/load-config.js';
import { GoogleRecaptchaVerifier } from './google-recaptcha-verifier.js';
import { type RecaptchaVerifier, RecaptchaUnavailableError } from './recaptcha.js';

/** Google with a secret; otherwise a verifier that never answers (the service doesn't call it: bypass or 503, CF-5). */
export function createRecaptchaVerifier(config: AppConfig): RecaptchaVerifier {
  const { recaptcha } = config.contact;
  if (recaptcha.mode === 'verify') return new GoogleRecaptchaVerifier(recaptcha.secretKey);
  return { verify: () => Promise.reject(new RecaptchaUnavailableError('not configured')) };
}
