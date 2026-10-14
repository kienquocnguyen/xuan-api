import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, AppConfigModule } from '../config/app-config.module.js';
import type { AppConfig } from '../config/load-config.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        type: 'postgres',
        url: config.database.url,
        autoLoadEntities: true, // entities arrive through each owning module's forFeature (I1)
        synchronize: false, // never (I7)
        migrationsRun: false, // migrations are explicit commands (I7)
      }),
    }),
  ],
})
export class DatabaseModule {}
