import { Controller, Get, Post, Query, Res, Body, Logger } from '@nestjs/common';
import { Response } from 'express';
import { OrdersService, AnalysisResult } from './orders.service';
import { TelegramService } from '../telegram/telegram.service';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import * as fs from 'fs';
import * as path from 'path';

@Controller('api')
export class OrdersController {
  private cachedResult: AnalysisResult | null = null;

  constructor(
    private readonly ordersService: OrdersService,
    private readonly telegramService: TelegramService,
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
  ) {}

  private readonly logger = new Logger(OrdersController.name);

  @Get('check')
  async checkOrders(
    @Query('refresh') refresh?: string,
    @Query('public_tracking') publicTracking?: string,
    @Query('threshold') threshold?: string,
    @Query('lookback') lookback?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const forceRefresh = refresh === 'true';
    const enablePublic = publicTracking === 'true';
    const customThreshold = threshold ? parseFloat(threshold) : undefined;
    const lookbackDays = lookback ? parseFloat(lookback) : undefined;
    const customPageSize = pageSize ? parseInt(pageSize, 10) : undefined;

    if (!this.cachedResult || forceRefresh || lookbackDays !== undefined || customThreshold !== undefined || customPageSize !== undefined) {
      this.logger.log(`🔍 [HTTP API CHECK] Kích hoạt quét dữ liệu mới (forceRefresh: ${forceRefresh}, threshold: ${customThreshold || 'mặc định'}, lookback: ${lookbackDays || 'mặc định'}d, pageSize: ${customPageSize || 200})`);
      this.cachedResult = await this.ordersService.analyzeStuckOrders({
        thresholdHours: customThreshold,
        enablePublicTracking: enablePublic,
        lookbackDays: lookbackDays,
        pageSize: customPageSize,
      });
    }

    return {
      success: true,
      data: this.cachedResult,
    };
  }

  @Post('reset')
  async resetSession(
    @Query('threshold') threshold?: string,
    @Query('lookback') lookback?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    this.logger.log(`🧹 [RESET PHIÊN MỚI] Đang xóa bộ nhớ tạm (cachedResult = null) và khởi tạo phiên quét mới 100% từ SV Express API...`);
    this.cachedResult = null; // Force clear cached RAM result
    const customThreshold = threshold ? parseFloat(threshold) : undefined;
    const lookbackDays = lookback ? parseFloat(lookback) : undefined;
    const customPageSize = pageSize ? parseInt(pageSize, 10) : undefined;

    const startTime = Date.now();
    this.cachedResult = await this.ordersService.analyzeStuckOrders({
      thresholdHours: customThreshold,
      enablePublicTracking: true,
      lookbackDays: lookbackDays,
      pageSize: customPageSize,
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    this.logger.log(`✅ [RESET PHIÊN HOÀN TẤT] Xóa cache thành công! Tìm thấy ${this.cachedResult.stuckTotal} đơn ngâm (Thời gian xử lý: ${elapsed}s).`);

    return {
      success: true,
      message: 'Đã xóa bộ nhớ tạm và làm mới phiên làm việc thành công!',
      data: this.cachedResult,
    };
  }

  @Get('export')
  async exportExcel(@Res() res: Response) {
    const result = await this.ordersService.analyzeStuckOrders();
    if (result.stuckOrders.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Không có đơn ngâm nào để xuất Excel.',
      });
    }

    const filePath = await this.ordersService.exportOrdersToExcel(result);
    return res.download(filePath);
  }

  @Post('telegram-notify')
  async notifyTelegram() {
    const result = this.cachedResult || await this.ordersService.analyzeStuckOrders();
    await this.telegramService.sendCronBroadcast(result);
    return {
      success: true,
      message: 'Đã gửi thông báo báo cáo thành công tới Telegram!',
    };
  }

  @Get('telegram-chats')
  async getTelegramChats() {
    try {
      const chats = await this.telegramService.getRecentChatIds();
      return {
        success: true,
        chats,
      };
    } catch (err) {
      return {
        success: false,
        message: err.message,
        chats: [],
      };
    }
  }

  @Get('config')
  getConfig() {
    return {
      stuckThresholdHours: parseFloat(this.settingsService.get('STUCK_THRESHOLD_HOURS', '24')) || 24,
      pageSize: parseInt(this.settingsService.get('PAGE_SIZE', '200'), 10) || 200,
      customerIds: this.settingsService.get('CUSTOMER_IDS', '28961,18363'),
      customerLabelsJson: this.settingsService.get('CUSTOMER_LABELS_JSON', '{"28961":"Khách VIP 28961","18363":"Khách 18363"}'),
      statusId: this.settingsService.get('STATUS_ID', '4'),
      statusLabelsJson: this.settingsService.get('STATUS_LABELS_JSON', '{"4":"Đang chuyển kho giao","2":"Đã lấy hàng","5":"Đang giao hàng","7":"Chờ xử lý / Hoàn hàng"}'),
      dateFilterType: this.settingsService.get('DATE_FILTER_TYPE', 'pickup_at'),
      svUsername: this.settingsService.get('SV_USERNAME', ''),
      // DO NOT return svPassword to Frontend for security!
      svPasswordConfigured: Boolean(this.settingsService.get('SV_PASSWORD')),
      svOrderApiUrl: this.settingsService.get('SV_ORDER_API_URL', 'https://api.svexpress.vn/v1/order'),
      svLoginApiUrl: this.settingsService.get('SV_LOGIN_API_URL', 'https://api.svexpress.vn/v1/auth/login'),
      telegramBotToken: this.settingsService.get('TELEGRAM_BOT_TOKEN', ''),
      telegramChatId: this.settingsService.get('TELEGRAM_CHAT_ID', ''),
      telegramPolling: this.settingsService.get('TELEGRAM_POLLING', 'false') === 'true',
      cronEnabled: this.settingsService.get('CRON_ENABLED', 'true') === 'true',
      cronSchedule: this.settingsService.get('CRON_SCHEDULE', '0 8,14 * * *'),
      jtPublicApi: this.settingsService.get('JT_PUBLIC_TRACKING_API_URL', ''),
      spxPublicApi: this.settingsService.get('SPX_PUBLIC_TRACKING_API_URL', ''),
    };
  }

  @Post('config')
  async updateConfig(@Body() body: any) {
    try {
      if (body.stuckThresholdHours !== undefined) {
        await this.settingsService.set('STUCK_THRESHOLD_HOURS', String(body.stuckThresholdHours));
      }
      if (body.pageSize !== undefined) {
        await this.settingsService.set('PAGE_SIZE', String(body.pageSize));
      }
      if (body.customerIds !== undefined) {
        await this.settingsService.set('CUSTOMER_IDS', String(body.customerIds));
      }
      if (body.customerLabelsJson !== undefined) {
        await this.settingsService.set('CUSTOMER_LABELS_JSON', typeof body.customerLabelsJson === 'string' ? body.customerLabelsJson : JSON.stringify(body.customerLabelsJson));
      }
      if (body.statusId !== undefined) {
        await this.settingsService.set('STATUS_ID', String(body.statusId));
      }
      if (body.statusLabelsJson !== undefined) {
        await this.settingsService.set('STATUS_LABELS_JSON', typeof body.statusLabelsJson === 'string' ? body.statusLabelsJson : JSON.stringify(body.statusLabelsJson));
      }
      if (body.svUsername !== undefined) {
        await this.settingsService.set('SV_USERNAME', String(body.svUsername));
      }
      if (body.telegramBotToken !== undefined) {
        await this.settingsService.set('TELEGRAM_BOT_TOKEN', String(body.telegramBotToken), true); // Encrypted in SQLite
      }
      if (body.telegramChatId !== undefined) {
        await this.settingsService.set('TELEGRAM_CHAT_ID', String(body.telegramChatId));
      }
      if (body.telegramPolling !== undefined) {
        await this.settingsService.set('TELEGRAM_POLLING', body.telegramPolling ? 'true' : 'false');
      }
      if (body.cronEnabled !== undefined) {
        await this.settingsService.set('CRON_ENABLED', body.cronEnabled ? 'true' : 'false');
      }
      if (body.cronSchedule !== undefined) {
        await this.settingsService.set('CRON_SCHEDULE', String(body.cronSchedule));
      }
      if (body.jtPublicApi !== undefined) {
        await this.settingsService.set('JT_PUBLIC_TRACKING_API_URL', String(body.jtPublicApi));
      }
      if (body.spxPublicApi !== undefined) {
        await this.settingsService.set('SPX_PUBLIC_TRACKING_API_URL', String(body.spxPublicApi));
      }

      // Encrypt and update password if a new password string is provided
      if (body.svPassword && body.svPassword.trim() !== '' && body.svPassword !== '••••••••') {
        await this.settingsService.set('SV_PASSWORD', body.svPassword.trim(), true); // Encrypted in SQLite
      }

      // Also sync to .env file as backup
      const envPath = path.join(__dirname, '../../../.env');
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf8');
        let lines = envContent.split('\n');
        const updates: Record<string, string> = {
          STUCK_THRESHOLD_HOURS: body.stuckThresholdHours !== undefined ? String(body.stuckThresholdHours) : undefined,
          CUSTOMER_IDS: body.customerIds !== undefined ? String(body.customerIds) : undefined,
          STATUS_ID: body.statusId !== undefined ? String(body.statusId) : undefined,
          SV_USERNAME: body.svUsername !== undefined ? String(body.svUsername) : undefined,
          TELEGRAM_BOT_TOKEN: body.telegramBotToken !== undefined ? String(body.telegramBotToken) : undefined,
          TELEGRAM_CHAT_ID: body.telegramChatId !== undefined ? String(body.telegramChatId) : undefined,
          TELEGRAM_POLLING: body.telegramPolling !== undefined ? (body.telegramPolling ? 'true' : 'false') : undefined,
          CRON_ENABLED: body.cronEnabled !== undefined ? (body.cronEnabled ? 'true' : 'false') : undefined,
          CRON_SCHEDULE: body.cronSchedule !== undefined ? String(body.cronSchedule) : undefined,
          JT_PUBLIC_TRACKING_API_URL: body.jtPublicApi !== undefined ? String(body.jtPublicApi) : undefined,
          SPX_PUBLIC_TRACKING_API_URL: body.spxPublicApi !== undefined ? String(body.spxPublicApi) : undefined,
        };

        if (body.svPassword && body.svPassword.trim() !== '' && body.svPassword !== '••••••••') {
          updates['SV_PASSWORD'] = body.svPassword.trim();
        }

        Object.keys(updates).forEach(key => {
          const val = updates[key];
          if (val !== undefined) {
            const index = lines.findIndex(line => line.startsWith(`${key}=`));
            if (index !== -1) {
              lines[index] = `${key}=${val}`;
            } else {
              lines.push(`${key}=${val}`);
            }
          }
        });

        fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
      }

      this.cachedResult = null;

      return {
        success: true,
        message: 'Đã lưu cấu hình mới vào cơ sở dữ liệu SQLite (Mã hóa AES-256) và đồng bộ .env!',
        config: this.getConfig(),
      };
    } catch (err) {
      return {
        success: false,
        message: `Lỗi khi lưu cấu hình SQLite: ${err.message}`,
      };
    }
  }
}
