import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { baselineErrors } from '../../../errors/baseline-errors.js';
import { Public } from '../../../http/auth/auth.decorators.js';
import { ApiEnvelopeResponse } from '../../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../../http/openapi/api-error-responses.js';
import { contactErrors } from '../contact.errors.js';
import { coachingErrors } from './coaching.errors.js';
import {
  CoachingRateLimitedError,
  CoachingRegistrationsService,
} from './coaching-registrations.service.js';
import {
  CoachingRegistrationReceiptDto,
  toCoachingRegistrationReceiptDto,
} from './dto/coaching-registration-receipt.dto.js';
import {
  type CreateCoachingRegistrationInput,
  createCoachingRegistrationSchema,
} from './dto/create-coaching-registration.dto.js';

const { VALIDATION_FAILED, FORBIDDEN, RATE_LIMITED } = baselineErrors;

/** The public coaching registration forms (coaching registrations design). No session; CSRF-checked. */
@ApiTags('contact')
@Controller('coaching-registrations')
export class CoachingRegistrationsController {
  constructor(private readonly registrations: CoachingRegistrationsService) {}

  // 202: accepted for review by Xuan; a repeat answers like the first.
  @Public()
  @Post()
  @HttpCode(202)
  @ApiEnvelopeResponse(CoachingRegistrationReceiptDto, { status: 202 })
  @ApiErrorResponses(
    VALIDATION_FAILED,
    FORBIDDEN,
    contactErrors.RECAPTCHA_VERIFICATION_FAILED,
    RATE_LIMITED,
    coachingErrors.COACHING_REGISTRATION_UNAVAILABLE,
  )
  async submit(
    @Body({ schema: createCoachingRegistrationSchema }) input: CreateCoachingRegistrationInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CoachingRegistrationReceiptDto> {
    try {
      // `req.ip` is the client behind TRUST_PROXY_HOPS proxies.
      return toCoachingRegistrationReceiptDto(
        await this.registrations.submit(input, req.ip ?? null),
      );
    } catch (error) {
      if (error instanceof CoachingRateLimitedError)
        res.setHeader('Retry-After', String(error.retryAfterSeconds));
      throw error;
    }
  }
}
