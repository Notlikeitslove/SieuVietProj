import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import { OrdersService, AnalysisResult } from '../orders/orders.service';
import axios from 'axios';

let TelegramBot: any = null;
try {
  TelegramBot = require('node-telegram-bot-api');
} catch (e) {}

export interface TelegramChatInfo {
  id: string;
  title: string;
  type: string;
}

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: any = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
    private readonly ordersService: OrdersService,
  ) {}

  onModuleInit() {
    this.initBot();
  }

  private initBot() {
    const token = this.settingsService.get('TELEGRAM_BOT_TOKEN') || this.configService.get<string>('telegramBotToken');
    const pollingSetting = this.settingsService.get('TELEGRAM_POLLING', 'false');
    const polling = pollingSetting === 'true' || this.configService.get<boolean>('telegramPolling');

    if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN') {
      this.logger.log('ℹ️ Telegram Bot chưa được cấu hình (Thiếu TELEGRAM_BOT_TOKEN)');
      return;
    }

    if (!TelegramBot) {
      this.logger.warn('⚠️ Thư viện node-telegram-bot-api chưa sẵn sàng.');
      return;
    }

    try {
      this.bot = new TelegramBot(token, { polling });
      this.logger.log(`🤖 Telegram Bot đã khởi tạo thành công! (${polling ? 'Polling ON' : 'Polling OFF'})`);

      if (polling) {
        this.setupCommands();
      }
    } catch (err) {
      this.logger.error(`❌ Lỗi khi khởi tạo Telegram Bot: ${err.message}`);
    }
  }

  /**
   * Auto-fetch recent group chat IDs from Telegram getUpdates endpoint
   */
  async getRecentChatIds(): Promise<TelegramChatInfo[]> {
    const token = this.settingsService.get('TELEGRAM_BOT_TOKEN') || this.configService.get<string>('telegramBotToken');
    if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN') {
      throw new Error('Chưa cấu hình Telegram Bot Token');
    }

    try {
      const res = await axios.get(`https://api.telegram.org/bot${token}/getUpdates`, { timeout: 8000 });
      const updates = res.data?.result || [];
      const chatsMap = new Map<string, TelegramChatInfo>();

      updates.forEach((u: any) => {
        const chat = u.message?.chat || u.channel_post?.chat || u.my_chat_member?.chat;
        if (chat && chat.id) {
          const idStr = String(chat.id);
          const title = chat.title || chat.username || `${chat.first_name || ''} ${chat.last_name || ''}`.trim() || 'Chat';
          chatsMap.set(idStr, {
            id: idStr,
            title,
            type: chat.type || 'private'
          });
        }
      });

      return Array.from(chatsMap.values());
    } catch (err) {
      throw new Error(`Lỗi khi lấy Telegram updates: ${err.response?.data?.description || err.message}`);
    }
  }

  private logInput(msg: any) {
    const chatId = msg.chat?.id || 'N/A';
    const sender = msg.from ? `${msg.from.first_name || ''} ${msg.from.last_name || ''} (@${msg.from.username || 'N/A'})`.trim() : 'Unknown';
    const text = msg.text || '';
    this.logger.log(`--------------------------------------------------------------------------------`);
    this.logger.log(`📥 [TELEGRAM BOT INPUT] Nhận lệnh từ Telegram Bot:`);
    this.logger.log(`   ├─ Chat ID  : ${chatId}`);
    this.logger.log(`   ├─ Người gửi : ${sender}`);
    this.logger.log(`   └─ Lệnh/Text : "${text}"`);
    this.logger.log(`--------------------------------------------------------------------------------`);
  }

  private async sendMessageWithLog(chatId: string | number, text: string, options: any = {}) {
    if (!this.bot) return;
    const preview = text.length > 80 ? text.substring(0, 80).replace(/\n/g, ' ') + '...' : text.replace(/\n/g, ' ');
    this.logger.log(`📤 [TELEGRAM BOT OUTPUT] Gửi phản hồi tới Chat ID (${chatId}): "${preview}"`);
    return await this.bot.sendMessage(chatId, text, options);
  }

  private async sendDocumentWithLog(chatId: string | number, docPath: string, options: any = {}) {
    if (!this.bot) return;
    this.logger.log(`📤 [TELEGRAM BOT OUTPUT FILE] Gửi file đính kèm tới Chat ID (${chatId}): ${docPath}`);
    return await this.bot.sendDocument(chatId, docPath, options);
  }

  private setupCommands() {
    if (!this.bot) return;

    this.bot.onText(/\/(start|help)/, (msg: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const helpText = 
`📖 *HƯỚNG DẪN SỬ DỤNG TELEGRAM BOT - AUTO CHECK GHSV*

Bộ lệnh điều khiển tự động:
🔹 \`/check\` - Quét ngay đơn bị ngâm & báo cáo tóm tắt theo NVC.
🔹 \`/excel\` - Quét dữ liệu và đính kèm file báo cáo Excel (\`.xlsx\`) gửi trực tiếp vào nhóm.
🔹 \`/status\` - Xem trạng thái hoạt động hệ thống, ngưỡng giờ ngâm & lịch Cron.
🔹 \`/setthreshold <số_giờ>\` - Đặt nhanh ngưỡng giờ ngâm (Ví dụ: \`/setthreshold 18\` để đổi ngưỡng ngâm thành 18h).
🔹 \`/cron <on|off>\` - Bật/Tắt lịch tự động quét gửi báo cáo (Ví dụ: \`/cron on\` hoặc \`/cron off\`).
🔹 \`/help\` - Xem hướng dẫn sử dụng này.`;

      this.sendMessageWithLog(chatId, helpText, { parse_mode: 'Markdown' });
    });

    this.bot.onText(/\/check/, async (msg: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      await this.sendMessageWithLog(chatId, '🚀 Đang quét dữ liệu từ API SV Express... Vui lòng chờ!');

      try {
        const result = await this.ordersService.analyzeStuckOrders();
        await this.sendReportMessage(chatId, result);
      } catch (err) {
        await this.sendMessageWithLog(chatId, `❌ Lỗi khi kiểm tra đơn hàng: ${err.message}`);
      }
    });

    this.bot.onText(/\/excel/, async (msg: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      await this.sendMessageWithLog(chatId, '📊 Đang quét dữ liệu và tạo file Excel...');

      try {
        const result = await this.ordersService.analyzeStuckOrders();
        if (result.stuckTotal === 0) {
          await this.sendMessageWithLog(chatId, '✅ Hiện tại không có đơn nào bị ngâm quá ngưỡng!');
          return;
        }

        const filePath = await this.ordersService.exportOrdersToExcel(result);
        await this.sendDocumentWithLog(chatId, filePath, {
          caption: `📊 File báo cáo đơn giục NVC (${result.stuckTotal} đơn ngâm > ${result.thresholdHours}h)`
        });
      } catch (err) {
        await this.sendMessageWithLog(chatId, `❌ Lỗi xuất file Excel: ${err.message}`);
      }
    });

    this.bot.onText(/\/status/, (msg: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const thresholdHours = this.settingsService.get('STUCK_THRESHOLD_HOURS', '24');
      const customerIds = this.settingsService.get('CUSTOMER_IDS', '28961,18363');
      const cronEnabled = this.settingsService.get('CRON_ENABLED', 'true');
      const cronSchedule = this.settingsService.get('CRON_SCHEDULE', '0 8,14 * * *');

      const statusText = 
`ℹ️ *TRẠNG THÁI HỆ THỐNG AUTO CHECK NESTJS*

- Ngưỡng giờ ngâm: *${thresholdHours}h*
- ID Khách hàng: *${customerIds}*
- Chế độ Cronjob: *${cronEnabled === 'true' ? 'Đang BẬT ✅' : 'Đang TẮT ❌'}*
- Biểu thức Cron: \`${cronSchedule}\``;

      this.sendMessageWithLog(chatId, statusText, { parse_mode: 'Markdown' });
    });

    this.bot.onText(/\/setthreshold\s+(\d+)/, async (msg: any, match: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const hours = parseInt(match[1], 10);
      if (hours > 0) {
        await this.settingsService.set('STUCK_THRESHOLD_HOURS', String(hours));
        await this.sendMessageWithLog(chatId, `✅ Đã cập nhật ngưỡng ngâm mới: *>= ${hours} giờ* vào SQLite DB!`, { parse_mode: 'Markdown' });
      }
    });

    this.bot.onText(/\/cron\s+(on|off)/i, async (msg: any, match: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const mode = match[1].toLowerCase() === 'on';
      await this.settingsService.set('CRON_ENABLED', mode ? 'true' : 'false');
      await this.sendMessageWithLog(chatId, `✅ Đã *${mode ? 'BẬT 🔔' : 'TẮT 🔕'}* chế độ quét tự động theo lịch (Cronjob)!`, { parse_mode: 'Markdown' });
    });
  }

  async sendReportMessage(chatId: string | number, result: AnalysisResult) {
    if (!this.bot) return;

    if (result.stuckTotal === 0) {
      await this.sendMessageWithLog(chatId, '✅ *TÌNH TRẠNG TỐT*: Hiện tại không có đơn nào bị ngâm quá ngưỡng!', { parse_mode: 'Markdown' });
      return;
    }

    let summaryText = `⚠️ *CẢNH BÁO: PHÁT HIỆN ${result.stuckTotal} ĐƠN CẦN GIỤC HÀNH TRÌNH*\n`;
    summaryText += `⏱️ _Ngưỡng ngâm: > ${result.thresholdHours} giờ_\n`;
    summaryText += `------------------------------------\n`;

    Object.keys(result.partnerSummary).forEach(partner => {
      const info = result.partnerSummary[partner];
      summaryText += `👉 *${partner}*: ${info.count} đơn (Lâu nhất: ${info.maxHoursStuck}h)\n`;
    });

    summaryText += `------------------------------------\n`;
    summaryText += `📋 *DANH SÁCH CHI TIẾT (15 ĐƠN ĐẦU TIÊN):*\n\n`;

    const topOrders = result.stuckOrders.slice(0, 15);
    topOrders.forEach((o, idx) => {
      summaryText += `${idx + 1}. *[${o.partnerName}]* Mã: \`${o.partnerCode}\`\n`;
      summaryText += `   ⏱️ Ngâm: *${o.hoursStuck}h* | Khách: ${o.customerName}\n`;
      summaryText += `   👤 Nhận: ${o.receiverName}\n\n`;
    });

    if (result.stuckTotal > 15) {
      summaryText += `📌 _...và còn ${result.stuckTotal - 15} đơn khác. Gõ lệnh /excel để lấy file đầy đủ._`;
    }

    await this.sendMessageWithLog(chatId, summaryText, { parse_mode: 'Markdown' });
  }

  async sendCronBroadcast(result: AnalysisResult) {
    const targetChatId = this.settingsService.get('TELEGRAM_CHAT_ID') || this.configService.get<string>('telegramChatId');
    if (!targetChatId || targetChatId === 'YOUR_TELEGRAM_CHAT_ID') return;
    
    await this.sendReportMessage(targetChatId, result);
    
    if (result.stuckTotal > 0 && this.bot) {
      try {
        const filePath = await this.ordersService.exportOrdersToExcel(result);
        await this.sendDocumentWithLog(targetChatId, filePath, {
          caption: `📊 File báo cáo tự động (${result.stuckTotal} đơn ngâm)`
        });
      } catch (err) {
        this.logger.error(`Lỗi khi gửi đính kèm file Telegram: ${err.message}`);
      }
    }
  }
}
