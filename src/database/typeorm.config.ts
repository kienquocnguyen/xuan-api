import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { loadConfig } from '../config/load-config.js';

export function getTypeOrmOptions(): TypeOrmModuleOptions {
  const config = loadConfig();

  return {
    type: 'postgres',
    url: config.database.url,
    autoLoadEntities: true,
    synchronize: false,
  };
}
