import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceOffering } from './service-offering.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([ServiceOffering])], // the only registration (I1)
})
export class ServicesModule {}
