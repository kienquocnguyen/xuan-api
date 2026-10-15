import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HttpContractModule } from './http/http-contract.module.js';
import { ContentModule } from './modules/content/content.module.js';
import { ServicesModule } from './modules/services/services.module.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    HttpContractModule,
    ServicesModule,
    UsersModule,
    ContentModule,
  ],
})
export class AppModule {}
