import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG } from '../../../config/app-config.module.js';
import type { AppConfig } from '../../../config/load-config.js';
import {
  assessRecaptcha,
  challengeAgeSeconds,
  RECAPTCHA_VERIFIER,
  RecaptchaUnavailableError,
  type RecaptchaVerifier,
} from './recaptcha.js';

export type HumanCheckOutcome = 'pass' | 'refused' | 'unavailable';

/** The reCAPTCHA decision shared by the public forms. The token is never logged. */
@Injectable()
export class HumanCheckService {
  private readonly logger = new Logger(HumanCheckService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RECAPTCHA_VERIFIER) private readonly recaptcha: RecaptchaVerifier,
  ) {}

  /** CF-4, CF-5. Not configured or Google unreachable fails closed; a refusal is logged with its reason, never sent. */
  async check(token: string, clientIp: string | null, action: string): Promise<HumanCheckOutcome> {
    const settings = this.config.contact.recaptcha;
    if (settings.mode === 'unconfigured') return 'unavailable';
    if (settings.mode !== 'verify') return 'pass'; // `bypass`: development and test only (config)
    let verdict: string;
    try {
      const result = await this.recaptcha.verify(token, clientIp);
      verdict = assessRecaptcha(result, settings, action);
      if (verdict !== 'pass') {
        if (result.errorCodes.length > 0) verdict += ` (${result.errorCodes.join(', ')})`;
        const age = challengeAgeSeconds(result, new Date());
        if (age !== null) verdict += `, challenge loaded ${age}s ago`;
      }
    } catch (error) {
      if (!(error instanceof RecaptchaUnavailableError)) throw error;
      this.logger.warn(error.message);
      return 'unavailable';
    }
    if (verdict === 'pass') return 'pass';
    this.logger.warn(`reCAPTCHA refused a submission for ${action}: ${verdict}`);
    return 'refused';
  }
}
