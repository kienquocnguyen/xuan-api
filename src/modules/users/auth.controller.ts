import { Controller, Get, HttpCode, Inject, Logger, Post, Query, Req, Res } from '@nestjs/common';
import {
  ApiExcludeEndpoint,
  ApiFoundResponse,
  ApiNoContentResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { APP_CONFIG } from '../../config/app-config.module.js';
import type { AppConfig } from '../../config/load-config.js';
import { AppError } from '../../errors/app-error.js';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { CurrentUser, Public } from '../../http/auth/auth.decorators.js';
import type { AuthenticatedUser } from '../../http/auth/role.js';
import { ApiEnvelopeResponse } from '../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../http/openapi/api-error-responses.js';
import { RawResponse } from '../../http/raw-response.decorator.js';
import { CurrentUserDto, toCurrentUserDto } from './dto/current-user.dto.js';
import {
  GOOGLE_IDENTITY_GATEWAY,
  type GoogleIdentity,
  type GoogleIdentityGateway,
} from './google/google-identity.gateway.js';
import {
  codeChallengeFor,
  createOAuthState,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
  parseOAuthState,
  returnToSchema,
  sameState,
  webRedirectUrl,
} from './oauth-state.js';
import { SESSION_COOKIE, SessionsService, sessionCookieOptions } from './sessions.service.js';
import { SignInError, type SignInFailure } from './users.errors.js';
import { UsersService } from './users.service.js';

export const googleSignInQuerySchema = z
  .strictObject({ returnTo: returnToSchema.optional() })
  .meta({ id: 'GoogleSignInQuery' });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    @Inject(GOOGLE_IDENTITY_GATEWAY) private readonly google: GoogleIdentityGateway,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Starts Google sign-in: a signed, short-lived state cookie, then a redirect to Google (auth design §4). */
  @Public()
  @Get('google')
  @RawResponse()
  @ApiFoundResponse({ description: 'Redirect to Google sign-in.' })
  @ApiErrorResponses(baselineErrors.VALIDATION_FAILED)
  startGoogleSignIn(
    @Query({ schema: googleSignInQuerySchema }) query: z.infer<typeof googleSignInQuerySchema>,
    @Res() response: Response,
  ): void {
    const oauth = createOAuthState(query.returnTo ?? '/');
    response.cookie(OAUTH_STATE_COOKIE, JSON.stringify(oauth), {
      ...this.stateCookieOptions(),
      maxAge: OAUTH_STATE_TTL_MS,
      signed: true,
    });
    response.redirect(
      302,
      this.google.authorizationUrl({
        state: oauth.state,
        codeChallenge: codeChallengeFor(oauth.verifier),
        nonce: oauth.nonce,
      }),
    );
  }

  /**
   * Google's redirect back. Every failure becomes `/login?authError=<code>` in the web app; success opens a
   * new session (replacing any presented one) and returns to the validated `returnTo`.
   */
  @Public()
  @Get('google/callback')
  @RawResponse()
  @ApiExcludeEndpoint()
  async completeGoogleSignIn(@Req() request: Request, @Res() response: Response): Promise<void> {
    const oauth = parseOAuthState(request.signedCookies?.[OAUTH_STATE_COOKIE]);
    response.clearCookie(OAUTH_STATE_COOKIE, this.stateCookieOptions()); // single use
    const fail = (code: SignInFailure) =>
      response.redirect(302, webRedirectUrl(this.config.auth.webUrl, `/login?authError=${code}`));

    const { code, state, error } = request.query;
    if (!oauth || error !== undefined || typeof code !== 'string' || typeof state !== 'string') {
      return fail('GOOGLE_SIGN_IN_FAILED');
    }
    if (!sameState(oauth.state, state)) return fail('GOOGLE_SIGN_IN_FAILED');

    let identity: GoogleIdentity;
    try {
      identity = await this.google.exchangeCode({
        code,
        codeVerifier: oauth.verifier,
        nonce: oauth.nonce,
      });
    } catch (exchangeError) {
      // Name only: messages from the provider may echo request data (I17).
      this.logger.warn(`Google code exchange failed: ${(exchangeError as Error).name}`);
      return fail('GOOGLE_SIGN_IN_FAILED');
    }

    let userId: string;
    try {
      userId = (await this.users.signInWithGoogle(identity)).id;
    } catch (signInError) {
      if (signInError instanceof SignInError) return fail(signInError.code);
      throw signInError;
    }

    await this.sessions.revoke(request.cookies?.[SESSION_COOKIE]); // no session fixation
    const token = await this.sessions.create(userId);
    response.cookie(SESSION_COOKIE, token, sessionCookieOptions(this.config));
    response.redirect(302, webRedirectUrl(this.config.auth.webUrl, oauth.returnTo));
  }

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

  private stateCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax', // sent on Google's top-level redirect back
      secure: this.config.auth.cookieSecure,
      path: '/auth/google',
    };
  }
}
