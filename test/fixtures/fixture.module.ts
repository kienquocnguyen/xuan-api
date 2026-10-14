import { Body, Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError } from '../../src/errors/app-error.js';
import { baselineErrors } from '../../src/errors/baseline-errors.js';
import { ApiEnvelopeResponse } from '../../src/http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../src/http/openapi/api-error-responses.js';

export const fixtureSchema = z
  .strictObject({
    name: z.string().min(1).max(5),
    address: z.strictObject({ city: z.string() }),
    tags: z.array(z.string().max(3)).optional(),
  })
  .meta({ id: 'FixtureEchoDto' });

class FixtureEchoResultDto {
  @ApiProperty() name!: string;
}

@Controller('__fixture')
class FixtureController {
  @Get('payload') payload() {
    return { hello: 'world' };
  }
  @Post('no-content') @HttpCode(204) noContent(): void {}
  @Get('undefined') returnsUndefined() {
    return undefined;
  }
  @Get('app-error') appError() {
    throw new AppError(baselineErrors.NOT_FOUND);
  }
  @Get('crash') crash() {
    throw new Error('relation "secret_table" does not exist');
  }
  @Post('echo')
  @ApiEnvelopeResponse(FixtureEchoResultDto, { status: 201 })
  @ApiErrorResponses(baselineErrors.VALIDATION_FAILED)
  echo(@Body({ schema: fixtureSchema }) body: z.infer<typeof fixtureSchema>) {
    return body;
  }
}

@Module({ controllers: [FixtureController] })
export class FixtureModule {}
