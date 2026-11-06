import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoursesModule } from '../courses/courses.module.js';
import { UsersModule } from '../users/users.module.js';
import { Order } from './order.entity.js';

/**
 * Course sales (course sales spec §5.1): orders, VNPAY checkout and the IPN. The only registration of `Order` (I1).
 * CoursesModule: for CourseSales; UsersModule: for UserProfilesReader (AD14).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Order]), CoursesModule, UsersModule],
})
export class OrdersModule {}
