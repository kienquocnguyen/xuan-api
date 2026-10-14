import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder().setTitle('xuan-api').setVersion('1').build();
  return SwaggerModule.createDocument(app, config);
}

/** Serves /docs and /docs-json. Called by configureApp only when config enables docs (D20). */
export function setupOpenApi(app: INestApplication): void {
  SwaggerModule.setup('docs', app, createOpenApiDocument(app));
}
