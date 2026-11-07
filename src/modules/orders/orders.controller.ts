import { Body, Controller, Get, Header, Param, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { CurrentUser } from '../../http/auth/auth.decorators.js';
import type { AuthenticatedUser } from '../../http/auth/role.js';
import { ApiEnvelopeResponse } from '../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../http/openapi/api-error-responses.js';
import { ApiSchemaParameters } from '../../http/openapi/api-schema-parameters.js';
import { CheckoutDto, OrderDto, toOrderDto } from './dto/order.dto.js';
import {
  type CreateOrderInput,
  createOrderSchema,
  type OrderReferenceParam,
  orderReferenceParamSchema,
} from './dto/order-requests.dto.js';
import { ordersErrors } from './orders.errors.js';
import { OrderRateLimitedError, OrdersService } from './orders.service.js';

const { VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, RATE_LIMITED } = baselineErrors;
const { COURSE_NOT_FOR_SALE, COURSE_ALREADY_OWNED, PAYMENTS_UNAVAILABLE } = ordersErrors;

/** A signed-in buyer's checkout and order status (course sales spec §5.4). Any role; the user is the session's (I9). */
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @ApiEnvelopeResponse(CheckoutDto, { status: 201 })
  @ApiErrorResponses(
    VALIDATION_FAILED,
    UNAUTHENTICATED,
    FORBIDDEN, // CsrfGuard: a write without X-Requested-With
    NOT_FOUND,
    COURSE_NOT_FOR_SALE,
    COURSE_ALREADY_OWNED,
    RATE_LIMITED,
    PAYMENTS_UNAVAILABLE,
  )
  async checkout(
    @Body({ schema: createOrderSchema }) input: CreateOrderInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CheckoutDto> {
    try {
      // `req.ip` is the client behind TRUST_PROXY_HOPS proxies (CF-8): VNPAY's vnp_IpAddr.
      const { view, paymentUrl } = await this.orders.checkout(user.id, input.courseId, req.ip);
      return { order: toOrderDto(view), paymentUrl };
    } catch (error) {
      if (error instanceof OrderRateLimitedError) {
        res.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }

  /** What xuan-web's result page polls after VNPAY's redirect; the query VNPAY appended is never trusted (S4). */
  @Get(':reference')
  @Header('Cache-Control', 'no-store')
  @ApiSchemaParameters('path', orderReferenceParamSchema)
  @ApiEnvelopeResponse(OrderDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, NOT_FOUND)
  async get(
    @Param({ schema: orderReferenceParamSchema }) params: OrderReferenceParam,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderDto> {
    return toOrderDto(await this.orders.getOwn(user.id, params.reference));
  }
}
