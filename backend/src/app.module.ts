import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { join } from 'path';

import configuration from './config/configuration';
import { SettingsModule } from './settings/settings.module';
import { AuthService } from './auth/auth.service';
import { TrackingService } from './tracking/tracking.service';
import { OrdersService } from './orders/orders.service';
import { OrdersController } from './orders/orders.controller';
import { TelegramService } from './telegram/telegram.service';
import { CronService } from './cron/cron.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: [join(__dirname, '../../.env'), join(__dirname, '../.env')],
    }),
    ScheduleModule.forRoot(),
    SettingsModule,
  ],
  controllers: [OrdersController],
  providers: [
    AuthService,
    TrackingService,
    OrdersService,
    TelegramService,
    CronService,
  ],
})
export class AppModule {}
