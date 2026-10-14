import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { AppConfigModule } from '../config/app-config.module.js';
import { AppError } from '../errors/app-error.js';
import { baselineErrors } from '../errors/baseline-errors.js';
import { CsrfGuard } from './auth/csrf.guard.js';
import { ContractExceptionFilter } from './contract-exception.filter.js';
import { SuccessEnvelopeInterceptor } from './success-envelope.interceptor.js';
import { toFieldErrors, type SchemaIssue } from './to-field-errors.js';

@Module({
  imports: [AppConfigModule],
  providers: [
    { provide: APP_GUARD, useClass: CsrfGuard }, // before the access guard (registration order)
    { provide: APP_FILTER, useClass: ContractExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
    {
      provide: APP_PIPE,
      useFactory: () =>
        new StandardSchemaValidationPipe({
          exceptionFactory: (issues) =>
            new AppError(baselineErrors.VALIDATION_FAILED, {
              fields: toFieldErrors(issues as readonly SchemaIssue[]),
            }),
        }),
    },
  ],
})
export class HttpContractModule {}
