import { z } from 'zod';
import { pageQueryFields } from '../../../http/pagination/page.js';
import { ORDER_STATUSES } from '../order.entity.js';

/** Checkout: the course only. Amount, user and status are never client input (I9). */
export const createOrderSchema = z
  .strictObject({ courseId: z.uuid() })
  .meta({ id: 'CreateOrderDto' });
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/** Same rule as ck_orders_reference_format: what VNPAY returns as `vnp_TxnRef` to the result page. */
export const orderReferenceParamSchema = z
  .strictObject({ reference: z.string().regex(/^[0-9a-f]{32}$/) })
  .meta({ id: 'OrderReferenceParam' });
export type OrderReferenceParam = z.infer<typeof orderReferenceParamSchema>;

export const adminOrdersQuerySchema = z
  .strictObject({
    status: z.enum(ORDER_STATUSES).optional(),
    ...pageQueryFields,
  })
  .meta({ id: 'AdminOrdersQuery' });
export type AdminOrdersQuery = z.infer<typeof adminOrdersQuerySchema>;
