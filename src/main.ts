import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { APP_CONFIG } from './config/app-config.module.js';
import type { AppConfig } from './config/load-config.js';
import { configureApp } from './http/configure-app.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const config = app.get<AppConfig>(APP_CONFIG); // invalid config already failed during create (I5)
  configureApp(app, config);
  app.enableShutdownHooks(); // TypeORM closes its pool on SIGTERM
  await app.listen(config.port);
}

// No top-level await: Vercel's launcher may require() this module, which Node refuses for an ESM graph with
// top-level await (ERR_REQUIRE_ASYNC_MODULE). A failed start is logged, then the process exits.
bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(
    'Startup failed.',
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});
