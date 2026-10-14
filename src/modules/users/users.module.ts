import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule } from '../../config/app-config.module.js';
import { AccessGuard } from './access.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthIdentity } from './auth-identity.entity.js';
import { Session } from './session.entity.js';
import { SessionsService } from './sessions.service.js';
import { User } from './user.entity.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AppConfigModule, TypeOrmModule.forFeature([User, AuthIdentity, Session])], // the only registration (I1)
  controllers: [AuthController],
  providers: [UsersService, SessionsService, { provide: APP_GUARD, useClass: AccessGuard }],
})
export class UsersModule {}
