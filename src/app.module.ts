import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getTypeOrmOptions } from './database/typeorm.config.js';

@Module({
  imports: [TypeOrmModule.forRoot(getTypeOrmOptions())],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
