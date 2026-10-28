import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import pg from 'pg';
import { APP_CONFIG, AppConfigModule } from '../config/app-config.module.js';
import type { AppConfig } from '../config/load-config.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        type: 'postgres',
        // Passed explicitly: TypeORM's own require('pg') is dynamic, so Vercel's file tracing drops pg.
        driver: pg,
        url: config.database.url,
        autoLoadEntities: true, // entities arrive through each owning module's forFeature (I1)
        synchronize: false, // never (I7)
        migrationsRun: false, // migrations are explicit commands (I7)
      }),
    }),
  ],
})
export class DatabaseModule {}
