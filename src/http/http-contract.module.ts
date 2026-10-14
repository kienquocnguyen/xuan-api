import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ContractExceptionFilter } from './contract-exception.filter.js';
import { SuccessEnvelopeInterceptor } from './success-envelope.interceptor.js';

@Module({
  providers: [
    { provide: APP_FILTER, useClass: ContractExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
export class HttpContractModule {}
