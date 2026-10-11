import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig } from './config/load-config.js';

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule);

  await app.listen(config.port);
}

await bootstrap();
