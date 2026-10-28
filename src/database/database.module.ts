import { Module } from '@nestjs/common';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import pg from 'pg';
import { APP_CONFIG, AppConfigModule } from '../config/app-config.module.js';
import type { AppConfig } from '../config/load-config.js';

/**
 * A serverless start must fail fast and visibly: pg has no connect timeout by default and Nest retries 10 times,
 * 3 s apart, so an unreachable database hung the Vercel Function with no output. Local runs keep Nest's retries
 * (the Docker database may still be starting).
 */
export function databaseOptions(config: AppConfig): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    // Passed explicitly: TypeORM's own require('pg') is dynamic, so Vercel's file tracing drops pg.
    driver: pg,
    url: config.database.url,
    connectTimeoutMS: 10_000,
    ...(config.env === 'production' && {
      retryAttempts: 2,
      retryDelay: 1_000,
      verboseRetryLog: true,
    }),
    autoLoadEntities: true, // entities arrive through each owning module's forFeature (I1)
    synchronize: false, // never (I7)
    migrationsRun: false, // migrations are explicit commands (I7)
  };
}

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [APP_CONFIG],
      useFactory: databaseOptions,
    }),
  ],
})
export class DatabaseModule {}
