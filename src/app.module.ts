import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HttpContractModule } from './http/http-contract.module.js';

@Module({
  imports: [AppConfigModule, DatabaseModule, HttpContractModule],
})
export class AppModule {}
