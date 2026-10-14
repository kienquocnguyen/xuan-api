import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ContractExceptionFilter } from './contract-exception.filter.js';

@Module({
  providers: [{ provide: APP_FILTER, useClass: ContractExceptionFilter }],
})
export class HttpContractModule {}
