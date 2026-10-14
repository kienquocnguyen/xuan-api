import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import { RAW_RESPONSE } from './raw-response.decorator.js';

@Injectable()
export class SuccessEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.reflector.get<boolean | undefined>(RAW_RESPONSE, context.getHandler())) {
      return next.handle(); // the handler wrote its own response (@RawResponse)
    }
    // @HttpCode(204) is read from the handler's metadata (architecture.md §16).
    const declared = this.reflector.get<number | undefined>(
      HTTP_CODE_METADATA,
      context.getHandler(),
    );
    return next.handle().pipe(
      map((payload: unknown) => {
        if (declared === HttpStatus.NO_CONTENT) return undefined; // I12: empty body
        if (payload === undefined) {
          // A payload route that returned nothing is a bug (I12): becomes a 500 through the filter.
          throw new Error(
            `${context.getClass().name}.${context.getHandler().name} returned undefined without @HttpCode(204)`,
          );
        }
        return { data: payload }; // I11
      }),
    );
  }
}
