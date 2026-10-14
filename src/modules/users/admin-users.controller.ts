import { Controller, Delete, Get, HttpCode, Param, Put, Query } from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { Roles } from '../../http/auth/auth.decorators.js';
import { ROLES } from '../../http/auth/role.js';
import { ApiEnvelopeResponse } from '../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../http/openapi/api-error-responses.js';
import { AdminUserDto, toAdminUserDto } from './dto/admin-user.dto.js';
import { usersErrors } from './users.errors.js';
import { UsersService } from './users.service.js';

export const adminUsersQuerySchema = z
  .strictObject({ role: z.enum(ROLES).optional() })
  .meta({ id: 'AdminUsersQuery' });

export const editorTargetSchema = z.strictObject({ userId: z.uuid() }).meta({ id: 'EditorTarget' });

const { VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND } = baselineErrors;

/**
 * Admin-only user management (auth design A12): list users, and move a user between `user` and `editor`.
 * No route grants or removes `admin`.
 */
@Roles('admin')
@ApiTags('admin')
@Controller('admin')
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}

  /** Unpaginated in V1: a small, admin-only list (pagination arrives with the first list that needs it). */
  @Get('users')
  @ApiEnvelopeResponse(AdminUserDto, { isArray: true })
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN)
  async listUsers(
    @Query({ schema: adminUsersQuerySchema }) query: z.infer<typeof adminUsersQuerySchema>,
  ): Promise<AdminUserDto[]> {
    const users = await this.users.listUsers(query.role);
    return users.map(toAdminUserDto);
  }

  /** user → editor; idempotent for an editor; 409 for an admin. */
  @Put('editors/:userId')
  @ApiEnvelopeResponse(AdminUserDto)
  @ApiErrorResponses(
    VALIDATION_FAILED,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    usersErrors.ADMIN_ROLE_LOCKED,
  )
  async grantEditor(
    @Param({ schema: editorTargetSchema }) params: z.infer<typeof editorTargetSchema>,
  ): Promise<AdminUserDto> {
    return toAdminUserDto(await this.users.grantEditor(params.userId));
  }

  /** editor → user (the account stays); idempotent for a user; 409 for an admin. */
  @Delete('editors/:userId')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'The user is not an editor (any more).' })
  @ApiErrorResponses(
    VALIDATION_FAILED,
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    usersErrors.ADMIN_ROLE_LOCKED,
  )
  async revokeEditor(
    @Param({ schema: editorTargetSchema }) params: z.infer<typeof editorTargetSchema>,
  ): Promise<void> {
    await this.users.revokeEditor(params.userId);
  }
}
