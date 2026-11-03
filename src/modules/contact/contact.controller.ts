import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { Public } from '../../http/auth/auth.decorators.js';
import { ApiEnvelopeResponse } from '../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../http/openapi/api-error-responses.js';
import { contactErrors } from './contact.errors.js';
import {
  ContactRateLimitedError,
  ContactSubmissionsService,
} from './contact-submissions.service.js';
import {
  type CreateContactSubmissionInput,
  createContactSubmissionSchema,
} from './dto/create-contact-submission.dto.js';
import {
  ContactSubmissionReceiptDto,
  toContactSubmissionReceiptDto,
} from './dto/contact-submission-receipt.dto.js';

const { VALIDATION_FAILED, FORBIDDEN, RATE_LIMITED } = baselineErrors;

/** The public contact form behind xuan-web's `/lien-he` (contact form design §3). No session; CSRF-checked. */
@ApiTags('contact')
@Controller('contact-submissions')
export class ContactController {
  constructor(private readonly submissions: ContactSubmissionsService) {}

  // 202: accepted for processing; the notification email may still be on its way (CF-3).
  @Public()
  @Post()
  @HttpCode(202)
  @ApiEnvelopeResponse(ContactSubmissionReceiptDto, { status: 202 })
  @ApiErrorResponses(
    VALIDATION_FAILED,
    FORBIDDEN,
    contactErrors.RECAPTCHA_VERIFICATION_FAILED,
    RATE_LIMITED,
    contactErrors.CONTACT_FORM_UNAVAILABLE,
  )
  async submit(
    @Body({ schema: createContactSubmissionSchema }) input: CreateContactSubmissionInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ContactSubmissionReceiptDto> {
    try {
      // `req.ip` is the client behind TRUST_PROXY_HOPS proxies (CF-8).
      return toContactSubmissionReceiptDto(await this.submissions.submit(input, req.ip ?? null));
    } catch (error) {
      if (error instanceof ContactRateLimitedError)
        res.setHeader('Retry-After', String(error.retryAfterSeconds));
      throw error;
    }
  }
}
