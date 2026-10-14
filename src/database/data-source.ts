import { DataSource } from 'typeorm';
import { loadConfig } from '../config/load-config.js';

const config = loadConfig();

export default new DataSource({
  type: 'postgres',
  url: config.database.url,
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
});
