import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { toContractError } from './to-contract-error.js';

@Catch()
export class ContractExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ContractExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const { status, body, unexpected } = toContractError(exception);

    if (unexpected) {
      // Method + route + error only. Never bodies, headers or cookies (I17).
      const error = exception instanceof Error ? exception : new Error(String(exception));
      const driver = (exception as { driverError?: { code?: string; constraint?: string } })
        .driverError;
      const db = driver ? ` [pg ${driver.code ?? '?'} ${driver.constraint ?? ''}]` : '';
      this.logger.error(
        `${request.method} ${request.route?.path ?? request.path} → ${error.name}: ${error.message}${db}`,
        error.stack,
      );
    }

    response.status(status).json(body);
  }
}
