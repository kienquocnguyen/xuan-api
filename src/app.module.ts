import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module.js';
import { DatabaseModule } from './database/database.module.js';

@Module({
  imports: [AppConfigModule, DatabaseModule],
})
export class AppModule {}
