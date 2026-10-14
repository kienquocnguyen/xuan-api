import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, AppConfigModule } from '../../config/app-config.module.js';
import type { AppConfig } from '../../config/load-config.js';
import { AccessGuard } from './access.guard.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AuthController } from './auth.controller.js';
import { AuthIdentity } from './auth-identity.entity.js';
import { GOOGLE_IDENTITY_GATEWAY } from './google/google-identity.gateway.js';
import { GoogleOAuthGateway } from './google/google-oauth.gateway.js';
import { Session } from './session.entity.js';
import { SessionsService } from './sessions.service.js';
import { User } from './user.entity.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AppConfigModule, TypeOrmModule.forFeature([User, AuthIdentity, Session])], // the only registration (I1)
  controllers: [AuthController, AdminUsersController],
  providers: [
    UsersService,
    SessionsService,
    { provide: APP_GUARD, useClass: AccessGuard },
    {
      provide: GOOGLE_IDENTITY_GATEWAY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new GoogleOAuthGateway(config.auth.google),
    },
  ],
})
export class UsersModule {}
