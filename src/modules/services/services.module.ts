import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceOffering } from './service-offering.entity.js';
import { ServicesController } from './services.controller.js';
import { ServicesCatalogService } from './services.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([ServiceOffering])], // the only registration (I1)
  controllers: [ServicesController],
  providers: [ServicesCatalogService],
})
export class ServicesModule {}
