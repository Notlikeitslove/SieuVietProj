import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import { OrdersService } from '../orders/orders.service';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
    private readonly ordersService: OrdersService,
    private readonly telegramService: TelegramService,
  ) {}

  // Run at 8:00 AM & 2:00 PM daily
  @Cron('0 8,14 * * *')
  async handleScheduledCheck() {
    const enabledSetting = this.settingsService.get('CRON_ENABLED', 'true');
    const cronEnabled = enabledSetting === 'true';
    if (!cronEnabled) return;

    this.logger.log(`⏰ [CRONJOB] Bắt đầu tự động quét đơn ngâm lúc ${new Date().toLocaleString('vi-VN')}...`);
    try {
      const result = await this.ordersService.analyzeStuckOrders();
      this.logger.log(`⏰ [CRONJOB] Quét xong: ${result.stuckTotal} / ${result.scannedTotal} đơn bị ngâm.`);
      
      await this.telegramService.sendCronBroadcast(result);
    } catch (err) {
      this.logger.error(`❌ [CRONJOB] Lỗi khi chạy tự động: ${err.message}`);
    }
  }
}
