import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthIdentity } from './auth-identity.entity.js';
import { Session } from './session.entity.js';
import { User } from './user.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([User, AuthIdentity, Session])], // the only registration (I1)
})
export class UsersModule {}
