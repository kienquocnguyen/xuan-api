import { Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { APP_CONFIG } from '../../config/app-config.module.js';
import type { AppConfig } from '../../config/load-config.js';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { CurrentUser, Public } from '../../http/auth/auth.decorators.js';
import type { AuthenticatedUser } from '../../http/auth/role.js';
import { ApiEnvelopeResponse } from '../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../http/openapi/api-error-responses.js';
import { CurrentUserDto, toCurrentUserDto } from './dto/current-user.dto.js';
import { SESSION_COOKIE, SessionsService, sessionCookieOptions } from './sessions.service.js';
import { UsersService } from './users.service.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('me')
  @ApiEnvelopeResponse(CurrentUserDto)
  @ApiErrorResponses(baselineErrors.UNAUTHENTICATED)
  async me(@CurrentUser() current: AuthenticatedUser): Promise<CurrentUserDto> {
    const user = await this.users.findById(current.id);
    if (!user) throw new AppError(baselineErrors.UNAUTHENTICATED);
    return toCurrentUserDto(user);
  }

  /** Ends the current session, if any. Idempotent; CSRF-checked like every POST. */
  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Signed out (or was not signed in).' })
  @ApiErrorResponses(baselineErrors.FORBIDDEN)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.revoke(request.cookies?.[SESSION_COOKIE]);
    const { maxAge: _maxAge, ...options } = sessionCookieOptions(this.config);
    response.clearCookie(SESSION_COOKIE, options);
  }
}
