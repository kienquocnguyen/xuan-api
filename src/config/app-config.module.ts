import { Module } from '@nestjs/common';
import { loadConfig } from './load-config.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
