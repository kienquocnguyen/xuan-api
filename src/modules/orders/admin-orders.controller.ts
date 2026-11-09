import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { Roles } from '../../http/auth/auth.decorators.js';
import { ApiErrorResponses } from '../../http/openapi/api-error-responses.js';
import { ApiPaginatedEnvelopeResponse } from '../../http/openapi/api-paginated-envelope-response.js';
import { ApiSchemaParameters } from '../../http/openapi/api-schema-parameters.js';
import { type Page, toPageInfo } from '../../http/pagination/page.js';
import { AdminOrderDto, toAdminOrderDto } from './dto/order.dto.js';
import { type AdminOrdersQuery, adminOrdersQuerySchema } from './dto/order-requests.dto.js';
import { OrdersService } from './orders.service.js';

const { VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN } = baselineErrors;

/** Orders for reconciliation with the VNPAY merchant portal (course sales spec §5.4): admins only. */
@Roles('admin')
@ApiTags('admin')
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiSchemaParameters('query', adminOrdersQuerySchema)
  @ApiPaginatedEnvelopeResponse(AdminOrderDto)
  @ApiErrorResponses(VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN)
  async list(
    @Query({ schema: adminOrdersQuerySchema }) query: AdminOrdersQuery,
  ): Promise<Page<AdminOrderDto>> {
    const { items, totalItems } = await this.orders.listForAdmin(query);
    return {
      items: items.map(toAdminOrderDto),
      pageInfo: toPageInfo(query.page, query.pageSize, totalItems),
    };
  }
}
