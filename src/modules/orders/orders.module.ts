import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule } from '../../config/app-config.module.js';
import { CoursesModule } from '../courses/courses.module.js';
import { UsersModule } from '../users/users.module.js';
import { AdminOrdersController } from './admin-orders.controller.js';
import { Order } from './order.entity.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { VnpayIpnController } from './vnpay-ipn.controller.js';
import { VnpayIpnService } from './vnpay-ipn.service.js';

/**
 * Course sales (course sales spec §5.1): orders, VNPAY checkout and the IPN. The only registration of `Order` (I1).
 * AppConfigModule: the VNPAY settings; CoursesModule: CourseSales; UsersModule: UserProfilesReader (AD14).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Order]), AppConfigModule, CoursesModule, UsersModule],
  controllers: [OrdersController, VnpayIpnController, AdminOrdersController],
  providers: [OrdersService, VnpayIpnService],
})
export class OrdersModule {}
