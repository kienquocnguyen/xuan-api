import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { baselineErrors } from '../../../errors/baseline-errors.js';
import { Roles } from '../../../http/auth/auth.decorators.js';
import { ApiEnvelopeResponse } from '../../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../../http/openapi/api-error-responses.js';
import { ApiPaginatedEnvelopeResponse } from '../../../http/openapi/api-paginated-envelope-response.js';
import { ApiSchemaParameters } from '../../../http/openapi/api-schema-parameters.js';
import { type Page, toPageInfo } from '../../../http/pagination/page.js';
import { CoachingInboxService } from './coaching-inbox.service.js';
import {
  AdminCoachingRegistrationDto,
  type AdminCoachingRegistrationsQuery,
  adminCoachingRegistrationsQuerySchema,
  type CoachingRegistrationIdParam,
  coachingRegistrationIdParamSchema,
  toAdminCoachingRegistrationDto,
} from './dto/admin-coaching-registration.dto.js';

const { VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND } = baselineErrors;

/** The coaching registrations inbox: admins only; editors and users → 403. */
@Roles('admin')
@ApiTags('admin')
@Controller('admin/coaching-registrations')
export class AdminCoachingRegistrationsController {
  constructor(private readonly inbox: CoachingInboxService) {}

  @Get()
  @ApiSchemaParameters('query', adminCoachingRegistrationsQuerySchema)
  @ApiPaginatedEnvelopeResponse(AdminCoachingRegistrationDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN)
  async list(
    @Query({ schema: adminCoachingRegistrationsQuerySchema })
    query: AdminCoachingRegistrationsQuery,
  ): Promise<Page<AdminCoachingRegistrationDto>> {
    const { items, totalItems } = await this.inbox.list(query);
    return {
      items: items.map((row) => toAdminCoachingRegistrationDto(row)),
      pageInfo: toPageInfo(query.page, query.pageSize, totalItems),
    };
  }

  // Reading never changes the status: GET stays safe.
  @Get(':registrationId')
  @ApiSchemaParameters('path', coachingRegistrationIdParamSchema)
  @ApiEnvelopeResponse(AdminCoachingRegistrationDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async get(
    @Param({ schema: coachingRegistrationIdParamSchema }) params: CoachingRegistrationIdParam,
  ): Promise<AdminCoachingRegistrationDto> {
    return toAdminCoachingRegistrationDto(await this.inbox.get(params.registrationId));
  }

  @Post(':registrationId/contacted')
  @HttpCode(200)
  @ApiSchemaParameters('path', coachingRegistrationIdParamSchema)
  @ApiEnvelopeResponse(AdminCoachingRegistrationDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async markContacted(
    @Param({ schema: coachingRegistrationIdParamSchema }) params: CoachingRegistrationIdParam,
  ): Promise<AdminCoachingRegistrationDto> {
    return toAdminCoachingRegistrationDto(await this.inbox.markContacted(params.registrationId));
  }

  @Post(':registrationId/archive')
  @HttpCode(200)
  @ApiSchemaParameters('path', coachingRegistrationIdParamSchema)
  @ApiEnvelopeResponse(AdminCoachingRegistrationDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  async archive(
    @Param({ schema: coachingRegistrationIdParamSchema }) params: CoachingRegistrationIdParam,
  ): Promise<AdminCoachingRegistrationDto> {
    return toAdminCoachingRegistrationDto(await this.inbox.archive(params.registrationId));
  }
}
