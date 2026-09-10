import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const logger = new Logger('NestBootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port') || 3000;

  // Enable CORS for ReactJS Frontend
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  await app.listen(port);
  
  logger.log(`================================================================================`);
  logger.log(`🚀 NESTJS BACKEND API STARTED SUCCESSFULLY`);
  logger.log(`================================================================================`);
  logger.log(`🌐 Server Base URL : http://localhost:${port}`);
  logger.log(`📡 API Endpoints   : http://localhost:${port}/api/check`);
  logger.log(`--------------------------------------------------------------------------------`);
}
bootstrap();
