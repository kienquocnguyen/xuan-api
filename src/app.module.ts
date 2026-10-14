import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getTypeOrmOptions } from './database/typeorm.config.js';

@Module({
  imports: [TypeOrmModule.forRoot(getTypeOrmOptions())],
})
export class AppModule {}
