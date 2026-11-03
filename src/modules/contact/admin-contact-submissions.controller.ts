import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { Roles } from '../../http/auth/auth.decorators.js';
import { ApiEnvelopeResponse } from '../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../http/openapi/api-error-responses.js';
import { ApiPaginatedEnvelopeResponse } from '../../http/openapi/api-paginated-envelope-response.js';
import { ApiSchemaParameters } from '../../http/openapi/api-schema-parameters.js';
import { type Page, toPageInfo } from '../../http/pagination/page.js';
import { contactErrors } from './contact.errors.js';
import { ContactInboxService } from './contact-inbox.service.js';
import {
  AdminContactSubmissionDto,
  type AdminContactSubmissionsQuery,
  adminContactSubmissionsQuerySchema,
  type ContactSubmissionIdParam,
  contactSubmissionIdParamSchema,
  toAdminContactSubmissionDto,
} from './dto/admin-contact-submission.dto.js';

const { VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND } = baselineErrors;

/** The contact inbox (contact form design CF-14): admins only; editors and users → 403. */
@Roles('admin')
@ApiTags('admin')
@Controller('admin/contact-submissions')
export class AdminContactSubmissionsController {
  constructor(private readonly inbox: ContactInboxService) {}

  @Get()
  @ApiSchemaParameters('query', adminContactSubmissionsQuerySchema)
  @ApiPaginatedEnvelopeResponse(AdminContactSubmissionDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN)
  async list(
    @Query({ schema: adminContactSubmissionsQuerySchema }) query: AdminContactSubmissionsQuery,
  ): Promise<Page<AdminContactSubmissionDto>> {
    const { items, totalItems } = await this.inbox.list(query);
    return {
      items: items.map((row) => toAdminContactSubmissionDto(row)),
      pageInfo: toPageInfo(query.page, query.pageSize, totalItems),
    };
  }

  // Reading never marks a submission read: GET stays safe (CF-14).
  @Get(':submissionId')
  @ApiSchemaParameters('path', contactSubmissionIdParamSchema)
  @ApiEnvelopeResponse(AdminContactSubmissionDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async get(
    @Param({ schema: contactSubmissionIdParamSchema }) params: ContactSubmissionIdParam,
  ): Promise<AdminContactSubmissionDto> {
    return toAdminContactSubmissionDto(await this.inbox.get(params.submissionId));
  }

  @Post(':submissionId/read')
  @HttpCode(200)
  @ApiSchemaParameters('path', contactSubmissionIdParamSchema)
  @ApiEnvelopeResponse(AdminContactSubmissionDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async markRead(
    @Param({ schema: contactSubmissionIdParamSchema }) params: ContactSubmissionIdParam,
  ): Promise<AdminContactSubmissionDto> {
    return toAdminContactSubmissionDto(await this.inbox.markRead(params.submissionId));
  }

  @Post(':submissionId/archive')
  @HttpCode(200)
  @ApiSchemaParameters('path', contactSubmissionIdParamSchema)
  @ApiEnvelopeResponse(AdminContactSubmissionDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async archive(
    @Param({ schema: contactSubmissionIdParamSchema }) params: ContactSubmissionIdParam,
  ): Promise<AdminContactSubmissionDto> {
    return toAdminContactSubmissionDto(await this.inbox.archive(params.submissionId));
  }

  // One attempt now when `notification.retryable`; otherwise the submission comes back unchanged (CF-13).
  @Post(':submissionId/notification/retry')
  @HttpCode(200)
  @ApiSchemaParameters('path', contactSubmissionIdParamSchema)
  @ApiEnvelopeResponse(AdminContactSubmissionDto)
  @ApiErrorResponses(
    VALIDATION_FAILED,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    contactErrors.CONTACT_NOTIFICATIONS_UNAVAILABLE,
  )
  async retryNotification(
    @Param({ schema: contactSubmissionIdParamSchema }) params: ContactSubmissionIdParam,
  ): Promise<AdminContactSubmissionDto> {
    return toAdminContactSubmissionDto(await this.inbox.retryNotification(params.submissionId));
  }
}
