import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import { OrdersService, AnalysisResult } from '../orders/orders.service';
import { ShopsService, ShopGroupRecord, ShopRecord } from '../shops/shops.service';
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

type GroupResolution =
  | { group: ShopGroupRecord; candidates?: undefined }
  | { group?: undefined; candidates: ShopGroupRecord[] }
  | { group?: undefined; candidates?: undefined };

interface ScopeResolution {
  ok: boolean;
  customerIds?: string[];
  scopeLabel?: string;
  message?: string;
}

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: any = null;

  // Tracks force-reply prompts we've sent (message_id -> what we're waiting for),
  // so a plain-text reply to that specific prompt can be routed correctly.
  private pendingPrompts = new Map<number, { type: 'findshop' | 'newgroup'; chatId: number }>();

  constructor(
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
    private readonly ordersService: OrdersService,
    private readonly shopsService: ShopsService,
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

      // CRITICAL: node-telegram-bot-api emits a bare 'error' event for some fatal
      // polling failures. An 'error' event with zero listeners is a special case in
      // Node's EventEmitter - it throws synchronously and crashes the whole process.
      // Without these handlers, a Telegram-side hiccup (e.g. two instances polling
      // at once -> 409 Conflict) can take down the entire backend, not just the bot.
      this.bot.on('polling_error', (err: any) => {
        this.logger.error(`⚠️ [TELEGRAM POLLING ERROR] ${err?.code || ''} ${err?.message || err}`);
      });
      this.bot.on('webhook_error', (err: any) => {
        this.logger.error(`⚠️ [TELEGRAM WEBHOOK ERROR] ${err?.message || err}`);
      });
      this.bot.on('error', (err: any) => {
        this.logger.error(`❌ [TELEGRAM FATAL ERROR] ${err?.message || err}`);
      });

      if (polling) {
        this.setupCommands();
        this.setupMenuHandlers();
        this.setupCallbackHandlers();
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
    this.logger.log(`   └─ Lệnh/Text : "${text.replace(/\n/g, ' \\n ')}"`);
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

  // ============================================================================
  // KEYBOARDS: Reply Keyboard (persistent bottom menu) + Inline Keyboards
  // (contextual buttons attached to a message, driven by callback_query)
  // ============================================================================

  private static readonly MENU = {
    CHECK_NOW: '🔍 Kiểm Tra Ngay',
    PICK_GROUP_CHECK: '🏪 Chọn Nhóm Quét',
    EXCEL_NOW: '📊 Xuất Excel',
    GROUP_LIST: '📋 Danh Sách Nhóm',
    FIND_SHOP: '🔎 Tìm Shop',
    CONFIG_QUICK: '⚙️ Cấu Hình Nhanh',
    STATUS: 'ℹ️ Trạng Thái',
    CANCEL_SCAN: '🛑 Dừng Quét',
    HELP: '❓ Trợ Giúp',
  };

  private buildMainReplyKeyboard() {
    const M = TelegramService.MENU;
    return {
      reply_markup: {
        keyboard: [
          [{ text: M.CHECK_NOW }, { text: M.PICK_GROUP_CHECK }],
          [{ text: M.EXCEL_NOW }, { text: M.GROUP_LIST }],
          [{ text: M.FIND_SHOP }, { text: M.CONFIG_QUICK }],
          [{ text: M.STATUS }, { text: M.CANCEL_SCAN }],
          [{ text: M.HELP }],
        ],
        resize_keyboard: true,
        is_persistent: true,
        input_field_placeholder: 'Chọn thao tác hoặc gõ lệnh /...',
      },
    };
  }

  private truncateLabel(text: string, max = 40): string {
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }

  private buildGroupsInlineKeyboard(groups: ShopGroupRecord[], mode: 'quick' | 'manage') {
    const rows = groups.map(g => ([{
      text: `${this.truncateLabel(g.name)} (${g.shops.length})`,
      callback_data: mode === 'quick' ? `qg:${g.id}` : `mg:${g.id}`,
    }]));
    if (mode === 'quick') {
      rows.push([{ text: '🌐 Tất Cả Shop', callback_data: 'qg:all' }]);
    } else {
      rows.push([{ text: '🌐 Xem Tất Cả Shop', callback_data: 'mg:all' }]);
      rows.push([{ text: '➕ Tạo Nhóm Mới', callback_data: 'mg:new' }]);
    }
    return { reply_markup: { inline_keyboard: rows } };
  }

  private buildGroupDetailInlineKeyboard(groupId: number) {
    return {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔍 Quét Nhóm Này', callback_data: `ga:check:${groupId}` }],
          [{ text: '✅ Áp Dụng Làm Bộ Lọc', callback_data: `ga:apply:${groupId}` }],
          [{ text: '📋 Xem Danh Sách Shop', callback_data: `ga:shops:${groupId}` }],
          [{ text: '🗑 Xóa Nhóm', callback_data: `ga:delask:${groupId}` }],
          [{ text: '⬅️ Quay Lại Danh Sách', callback_data: 'mg:list' }],
        ],
      },
    };
  }

  private buildDeleteConfirmInlineKeyboard(groupId: number) {
    return {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Xác Nhận Xóa', callback_data: `ga:delyes:${groupId}` },
            { text: '❌ Hủy', callback_data: `ga:delno:${groupId}` },
          ],
        ],
      },
    };
  }

  private buildConfigMenuInlineKeyboard() {
    const thresholdHours = this.settingsService.get('STUCK_THRESHOLD_HOURS', '24');
    const lookback = this.settingsService.get('DEFAULT_LOOKBACK_DAYS', '60');
    const maxPages = this.settingsService.get('MAX_SCAN_PAGES', '300');
    const cronOn = this.settingsService.get('CRON_ENABLED', 'true') === 'true';
    return {
      reply_markup: {
        inline_keyboard: [
          [{ text: `⏱ Ngưỡng Ngâm: ${thresholdHours}h ▸`, callback_data: 'cm:th' }],
          [{ text: `📅 Thời Gian Quét: ${lookback} ngày ▸`, callback_data: 'cm:lb' }],
          [{ text: `🛡 Giới Hạn Trang: ${maxPages} ▸`, callback_data: 'cm:mp' }],
          [{ text: `🔔 Cron: ${cronOn ? 'ĐANG BẬT — Bấm để TẮT' : 'ĐANG TẮT — Bấm để BẬT'}`, callback_data: 'cm:cron' }],
        ],
      },
    };
  }

  private buildValuePickerInlineKeyboard(prefix: 'th' | 'lb' | 'mp', values: string[], suffix: string) {
    const buttons = values.map(v => ({ text: `${v}${suffix}`, callback_data: `cm:${prefix}:${v}` }));
    const rows: any[] = [];
    for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3));
    rows.push([{ text: '⬅️ Quay Lại', callback_data: 'cm:main' }]);
    return { reply_markup: { inline_keyboard: rows } };
  }

  // ============================================================================
  // HELPERS: Vietnamese-diacritic-insensitive fuzzy matching for group names
  // ============================================================================

  private normalizeVi(text: string): string {
    return (text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/gi, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private async resolveGroup(query: string): Promise<GroupResolution> {
    const q = (query || '').trim();
    if (!q) return {};
    const groups = await this.shopsService.getGroupsWithShops();

    // 1) exact numeric group ID
    if (/^\d+$/.test(q)) {
      const byId = groups.find(g => g.id === parseInt(q, 10));
      if (byId) return { group: byId };
    }

    const normQ = this.normalizeVi(q);

    // 2) exact normalized name match
    const exact = groups.filter(g => this.normalizeVi(g.name) === normQ);
    if (exact.length === 1) return { group: exact[0] };
    if (exact.length > 1) return { candidates: exact };

    // 3) substring match (either direction), e.g. "nhom1" matches "Nhóm 1: J&T và Viettel"
    const partial = groups.filter(g => {
      const normG = this.normalizeVi(g.name);
      return normG.includes(normQ) || normQ.includes(normG);
    });
    if (partial.length === 1) return { group: partial[0] };
    if (partial.length > 1) return { candidates: partial };

    return {};
  }

  private async findShops(query: string): Promise<Array<ShopRecord & { groupName: string }>> {
    const groups = await this.shopsService.getGroupsWithShops();
    const ungrouped = await this.shopsService.getUngroupedShops();
    const all = [
      ...groups.flatMap(g => g.shops.map(s => ({ ...s, groupName: g.name }))),
      ...ungrouped.map(s => ({ ...s, groupName: 'Chưa phân nhóm' })),
    ];
    const rawQ = query.trim();
    const normQ = this.normalizeVi(rawQ);
    if (!normQ && !rawQ) return [];
    return all.filter(s =>
      s.svCustomerId.includes(rawQ) ||
      this.normalizeVi(s.name).includes(normQ) ||
      (s.phone || '').includes(rawQ)
    );
  }

  // ============================================================================
  // HELPER: Resolve a "scope" argument (blank / "all" / a group name) shared by
  // /check and /excel so both commands support the exact same targeting syntax.
  // ============================================================================

  private async resolveScopeArg(arg: string): Promise<ScopeResolution> {
    const trimmed = (arg || '').trim();
    if (!trimmed) return { ok: true }; // no override -> use the globally saved CUSTOMER_IDS filter

    const normQ = this.normalizeVi(trimmed);
    if (['all', 'tatca', 'toanbo', 'allshop', 'allshops'].includes(normQ)) {
      const groups = await this.shopsService.getGroupsWithShops();
      const ungrouped = await this.shopsService.getUngroupedShops();
      const allShops = [...groups.flatMap(g => g.shops), ...ungrouped];
      if (allShops.length === 0) return { ok: false, message: '⚠️ Hệ thống chưa có shop nào. Dùng /addshop hoặc /addshops để thêm.' };
      return { ok: true, customerIds: allShops.map(s => s.svCustomerId), scopeLabel: `Tất cả ${allShops.length} shop` };
    }

    const resolved = await this.resolveGroup(trimmed);
    if (resolved.candidates) {
      return {
        ok: false,
        message: `⚠️ Có nhiều nhóm khớp "${trimmed}":\n${resolved.candidates.map(c => `• ${c.name}`).join('\n')}\nGõ tên đầy đủ/chính xác hơn.`,
      };
    }
    if (!resolved.group) {
      return { ok: false, message: `❌ Không tìm thấy nhóm "${trimmed}". Gõ /groups để xem danh sách nhóm hiện có.` };
    }
    if (resolved.group.shops.length === 0) {
      return { ok: false, message: `⚠️ Nhóm "${resolved.group.name}" chưa có shop nào.` };
    }
    return { ok: true, customerIds: resolved.group.shops.map(s => s.svCustomerId), scopeLabel: resolved.group.name };
  }

  // ============================================================================
  // CORE: Run a check / Excel export against a resolved scope
  // ============================================================================

  private async runCheckAndReport(chatId: string | number, scope: { customerIds?: string[]; scopeLabel?: string }) {
    const label = scope.scopeLabel ? ` (${scope.scopeLabel})` : '';
    await this.sendMessageWithLog(chatId, `🚀 Đang quét dữ liệu${label}... Vui lòng chờ!`);
    try {
      const result = await this.ordersService.analyzeStuckOrders(scope.customerIds ? { customerIds: scope.customerIds } : {});
      await this.sendReportMessage(chatId, result, scope.scopeLabel);
    } catch (err) {
      await this.sendMessageWithLog(chatId, `❌ Lỗi khi kiểm tra đơn hàng: ${err.message}`);
    }
  }

  private async runExcelAndSend(chatId: string | number, scope: { customerIds?: string[]; scopeLabel?: string }) {
    const label = scope.scopeLabel ? ` (${scope.scopeLabel})` : '';
    await this.sendMessageWithLog(chatId, `📊 Đang quét dữ liệu${label} và tạo file Excel...`);
    try {
      const result = await this.ordersService.analyzeStuckOrders(scope.customerIds ? { customerIds: scope.customerIds } : {});
      if (result.stuckTotal === 0) {
        await this.sendMessageWithLog(chatId, `✅ Hiện tại không có đơn nào bị ngâm quá ngưỡng${label}!`);
        return;
      }
      const filePath = await this.ordersService.exportOrdersToExcel(result);
      await this.sendDocumentWithLog(chatId, filePath, {
        caption: `📊 File báo cáo${label} (${result.stuckTotal} đơn ngâm > ${result.thresholdHours}h)`,
      });
    } catch (err) {
      await this.sendMessageWithLog(chatId, `❌ Lỗi xuất file Excel: ${err.message}`);
    }
  }

  // ============================================================================
  // COMMANDS
  // ============================================================================

  private setupCommands() {
    if (!this.bot) return;

    // ---- /start, /menu (persistent Reply Keyboard) ----
    this.bot.onText(/^\/(start|menu)(?:@\w+)?$/, (msg: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const welcomeText =
`👋 *CHÀO MỪNG ĐẾN VỚI BOT AUTO CHECK GHSV*

Dùng bảng nút bên dưới để thao tác nhanh, hoặc gõ /help để xem đầy đủ lệnh dạng gõ tay (kể cả thao tác hàng loạt).`;
      this.sendMessageWithLog(chatId, welcomeText, { parse_mode: 'Markdown', ...this.buildMainReplyKeyboard() });
    });

    // ---- /help ----
    this.bot.onText(/^\/help(?:@\w+)?$/, (msg: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const helpText =
`📖 *HƯỚNG DẪN SỬ DỤNG BOT - AUTO CHECK GHSV*

💡 Gõ /menu để hiện bảng nút bấm nhanh (dễ dùng nhất cho các thao tác thường ngày).

*🔍 KIỂM TRA & BÁO CÁO*
🔹 \`/check\` — Quét theo bộ lọc đang áp dụng hiện tại
🔹 \`/check <nhóm>\` — Quét riêng 1 nhóm (VD: \`/check Nhóm 1\`)
🔹 \`/check all\` hoặc \`/checkall\` — Quét TẤT CẢ shop trong hệ thống
🔹 \`/excel [nhóm|all]\` — Như /check nhưng xuất kèm file Excel
🔹 \`/cancel\` — Dừng ngay phiên quét đang chạy
🔹 \`/status\` — Xem trạng thái hệ thống hiện tại

*🏪 XEM NHÓM & SHOP*
🔹 \`/groups\` — Liệt kê tất cả nhóm shop
🔹 \`/group <nhóm>\` — Xem chi tiết shop trong 1 nhóm
🔹 \`/findshop <từ khóa>\` — Tìm shop theo tên/SĐT/ID

*⚙️ CẤU HÌNH NHANH*
🔹 \`/setthreshold <giờ>\` — Đặt ngưỡng ngâm
🔹 \`/setlookback <ngày>\` — Đặt thời gian quét mặc định
🔹 \`/setmaxpages <số>\` — Đặt giới hạn an toàn số trang/lần quét
🔹 \`/cron <on|off>\` — Bật/tắt lịch tự động quét
🔹 \`/applygroup <nhóm>\` — Đặt 1 nhóm làm bộ lọc chính thức
🔹 \`/applyall\` — Đặt TẤT CẢ shop làm bộ lọc chính thức

*🗂 QUẢN LÝ NHÓM (CRUD)*
🔹 \`/newgroup <tên>\` — Tạo nhóm mới
🔹 \`/renamegroup <cũ> => <mới>\` — Đổi tên nhóm
🔹 \`/delgroup <nhóm> confirm\` — Xóa nhóm (+ toàn bộ shop trong đó)

*🏷 QUẢN LÝ SHOP (CRUD)*
🔹 \`/addshop <ID> | <Tên> | <SĐT> | <Nhóm>\` — Thêm 1 shop
🔹 \`/delshop <ID>\` — Xóa 1 shop
🔹 \`/moveshop <ID> => <Nhóm>\` — Chuyển 1 shop sang nhóm khác

*📦 THAO TÁC HÀNG LOẠT (BULK)*
🔹 \`/addshops <Tên Nhóm>\` rồi xuống dòng, mỗi dòng 1 shop:
\`ID | Tên Shop | SĐT\`
(gửi tất cả trong CÙNG 1 tin nhắn, nhiều dòng)
🔹 \`/delshops <ID1,ID2,...> confirm\` — Xóa nhiều shop cùng lúc
🔹 \`/moveshops <ID1,ID2,...> => <Nhóm>\` — Chuyển nhiều shop cùng lúc

_Tên nhóm không cần gõ chính xác 100% — bot tự nhận diện gần đúng, không dấu cũng được (VD: "nhom1" nhận ra "Nhóm 1: J\\&T và Viettel")._`;

      this.sendMessageWithLog(chatId, helpText, { parse_mode: 'Markdown' });
    });

    // ---- /check [nhóm|all] ----
    this.bot.onText(/^\/check(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg: any, match: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const scope = await this.resolveScopeArg(match[1] || '');
      if (!scope.ok) {
        await this.sendMessageWithLog(chatId, scope.message);
        return;
      }
      await this.runCheckAndReport(chatId, scope);
    });

    // ---- /checkall (alias for /check all) ----
    this.bot.onText(/^\/checkall(?:@\w+)?$/, async (msg: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const scope = await this.resolveScopeArg('all');
      if (!scope.ok) {
        await this.sendMessageWithLog(chatId, scope.message);
        return;
      }
      await this.runCheckAndReport(chatId, scope);
    });

    // ---- /excel [nhóm|all] ----
    this.bot.onText(/^\/excel(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg: any, match: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const scope = await this.resolveScopeArg(match[1] || '');
      if (!scope.ok) {
        await this.sendMessageWithLog(chatId, scope.message);
        return;
      }
      await this.runExcelAndSend(chatId, scope);
    });

    // ---- /cancel ----
    this.bot.onText(/^\/cancel(?:@\w+)?$/, async (msg: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const stopped = this.ordersService.requestCancelScan();
      await this.sendMessageWithLog(
        chatId,
        stopped
          ? '🛑 Đã gửi yêu cầu dừng quét. Hệ thống sẽ dừng ngay sau khi xử lý xong bước hiện tại.'
          : 'ℹ️ Hiện không có phiên quét nào đang chạy để dừng.'
      );
    });

    // ---- /status ----
    this.bot.onText(/^\/status(?:@\w+)?$/, async (msg: any) => {
      this.logInput(msg);
      await this.sendStatusMessage(msg.chat.id);
    });

    // ---- /groups ----
    this.bot.onText(/^\/groups(?:@\w+)?$/, async (msg: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const groups = await this.shopsService.getGroupsWithShops();
      const ungrouped = await this.shopsService.getUngroupedShops();

      if (groups.length === 0) {
        await this.sendMessageWithLog(chatId, '📭 Chưa có nhóm shop nào. Dùng /newgroup <tên> để tạo nhóm đầu tiên.');
        return;
      }

      const customerIds = this.settingsService.get('CUSTOMER_IDS', '').split(',').map(s => s.trim()).filter(Boolean);
      const idSet = new Set(customerIds);
      const totalShops = groups.reduce((sum, g) => sum + g.shops.length, 0);

      let text = `🏪 *DANH SÁCH NHÓM SHOP* (${groups.length} nhóm, ${totalShops} shop)\n\n`;
      groups.forEach(g => {
        const isActive = g.shops.length > 0 && g.shops.length === idSet.size && g.shops.every(s => idSet.has(s.svCustomerId));
        text += `${isActive ? '✅' : '🔹'} *#${g.id} ${g.name}* — ${g.shops.length} shop${isActive ? ' _(đang áp dụng)_' : ''}\n`;
      });
      if (ungrouped.length > 0) {
        text += `\n❓ *Chưa phân nhóm*: ${ungrouped.length} shop\n`;
      }
      text += `\n_Gõ /group <tên nhóm> để xem chi tiết. Gõ /check <tên nhóm> để quét riêng nhóm đó._`;

      await this.sendMessageWithLog(chatId, text, { parse_mode: 'Markdown' });
    });

    // ---- /group <nhóm> ----
    this.bot.onText(/^\/group(?:@\w+)?\s+([\s\S]+)$/, async (msg: any, match: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const query = match[1].trim();
      const resolved = await this.resolveGroup(query);
      if (resolved.candidates) {
        await this.sendMessageWithLog(chatId, `⚠️ Có nhiều nhóm khớp "${query}":\n${resolved.candidates.map(c => `• ${c.name}`).join('\n')}`);
        return;
      }
      if (!resolved.group) {
        await this.sendMessageWithLog(chatId, `❌ Không tìm thấy nhóm "${query}". Gõ /groups để xem danh sách.`);
        return;
      }
      const g = resolved.group;
      let text = `🗂 *${g.name}* (${g.shops.length} shop)\n\n`;
      if (g.shops.length === 0) {
        text += '_(chưa có shop nào trong nhóm này)_';
      } else {
        g.shops.forEach((s, i) => {
          text += `${i + 1}. \`${s.svCustomerId}\` — ${s.name}${s.phone ? ` (${s.phone})` : ''}\n`;
        });
      }
      await this.sendMessageWithLog(chatId, text, { parse_mode: 'Markdown' });
    });

    // ---- /findshop <từ khóa> ----
    this.bot.onText(/^\/findshop(?:@\w+)?\s+([\s\S]+)$/, async (msg: any, match: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const kw = match[1].trim();
      const found = await this.findShops(kw);
      if (found.length === 0) {
        await this.sendMessageWithLog(chatId, `❌ Không tìm thấy shop nào khớp "${kw}".`);
        return;
      }
      let text = `🔍 *Tìm thấy ${found.length} shop khớp "${kw}":*\n\n`;
      found.slice(0, 25).forEach(s => {
        text += `• \`${s.svCustomerId}\` — ${s.name} _(${s.groupName})_\n`;
      });
      if (found.length > 25) text += `\n_...và ${found.length - 25} shop khác. Thu hẹp từ khóa để xem rõ hơn._`;
      await this.sendMessageWithLog(chatId, text, { parse_mode: 'Markdown' });
    });

    // ---- /setthreshold <giờ> ----
    this.bot.onText(/^\/setthreshold(?:@\w+)?\s+(\d+(?:\.\d+)?)$/, async (msg: any, match: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const hours = parseFloat(match[1]);
      if (hours > 0) {
        await this.settingsService.set('STUCK_THRESHOLD_HOURS', String(hours));
        await this.sendMessageWithLog(chatId, `✅ Đã cập nhật ngưỡng ngâm mới: *>= ${hours} giờ*.`, { parse_mode: 'Markdown' });
      }
    });

    // ---- /setlookback <ngày> ----
    this.bot.onText(/^\/setlookback(?:@\w+)?\s+(\d+)$/, async (msg: any, match: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const days = parseInt(match[1], 10);
      if (days > 0) {
        await this.settingsService.set('DEFAULT_LOOKBACK_DAYS', String(days));
        await this.sendMessageWithLog(chatId, `✅ Đã đặt thời gian quét mặc định: *${days} ngày*.`, { parse_mode: 'Markdown' });
      }
    });

    // ---- /setmaxpages <số> ----
    this.bot.onText(/^\/setmaxpages(?:@\w+)?\s+(\d+)$/, async (msg: any, match: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const pages = parseInt(match[1], 10);
      if (pages > 0) {
        await this.settingsService.set('MAX_SCAN_PAGES', String(pages));
        await this.sendMessageWithLog(chatId, `✅ Đã đặt giới hạn an toàn: *${pages} trang* mỗi lần quét.`, { parse_mode: 'Markdown' });
      }
    });

    // ---- /cron <on|off> ----
    this.bot.onText(/^\/cron(?:@\w+)?\s+(on|off)$/i, async (msg: any, match: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const mode = match[1].toLowerCase() === 'on';
      await this.settingsService.set('CRON_ENABLED', mode ? 'true' : 'false');
      await this.sendMessageWithLog(chatId, `✅ Đã *${mode ? 'BẬT 🔔' : 'TẮT 🔕'}* chế độ quét tự động theo lịch (Cronjob)!`, { parse_mode: 'Markdown' });
    });

    // ---- /applygroup <nhóm> ----
    this.bot.onText(/^\/applygroup(?:@\w+)?\s+([\s\S]+)$/, async (msg: any, match: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const query = match[1].trim();
      const resolved = await this.resolveGroup(query);
      if (resolved.candidates) {
        await this.sendMessageWithLog(chatId, `⚠️ Có nhiều nhóm khớp "${query}":\n${resolved.candidates.map(c => `• ${c.name}`).join('\n')}`);
        return;
      }
      if (!resolved.group) {
        await this.sendMessageWithLog(chatId, `❌ Không tìm thấy nhóm "${query}". Gõ /groups để xem danh sách.`);
        return;
      }
      const g = resolved.group;
      if (g.shops.length === 0) {
        await this.sendMessageWithLog(chatId, `⚠️ Nhóm "${g.name}" chưa có shop nào, không thể áp dụng.`);
        return;
      }
      const customerIds = g.shops.map(s => s.svCustomerId).join(',');
      const labelsMap: Record<string, string> = {};
      g.shops.forEach(s => { labelsMap[s.svCustomerId] = s.name || s.svCustomerId; });
      await this.settingsService.set('CUSTOMER_IDS', customerIds);
      await this.settingsService.set('CUSTOMER_LABELS_JSON', JSON.stringify(labelsMap));
      await this.sendMessageWithLog(chatId, `✅ Đã áp dụng nhóm *"${g.name}"* (${g.shops.length} shop) làm bộ lọc rà soát chính thức.`, { parse_mode: 'Markdown' });
    });

    // ---- /applyall ----
    this.bot.onText(/^\/applyall(?:@\w+)?$/, async (msg: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const groups = await this.shopsService.getGroupsWithShops();
      const ungrouped = await this.shopsService.getUngroupedShops();
      const allShops = [...groups.flatMap(g => g.shops), ...ungrouped];
      if (allShops.length === 0) {
        await this.sendMessageWithLog(chatId, '⚠️ Hệ thống chưa có shop nào.');
        return;
      }
      const customerIds = allShops.map(s => s.svCustomerId).join(',');
      const labelsMap: Record<string, string> = {};
      allShops.forEach(s => { labelsMap[s.svCustomerId] = s.name || s.svCustomerId; });
      await this.settingsService.set('CUSTOMER_IDS', customerIds);
      await this.settingsService.set('CUSTOMER_LABELS_JSON', JSON.stringify(labelsMap));
      await this.sendMessageWithLog(chatId, `✅ Đã áp dụng *TẤT CẢ ${allShops.length} shop* làm bộ lọc rà soát chính thức.`, { parse_mode: 'Markdown' });
    });

    // ---- /newgroup <tên> ----
    this.bot.onText(/^\/newgroup(?:@\w+)?\s+([\s\S]+)$/, async (msg: any, match: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const name = match[1].trim();
      try {
        await this.shopsService.createGroup(name);
        await this.sendMessageWithLog(chatId, `✅ Đã tạo nhóm "${name}".`);
      } catch (err) {
        await this.sendMessageWithLog(chatId, `❌ ${err.message}`);
      }
    });

    // ---- /renamegroup <cũ> => <mới> ----
    this.bot.onText(/^\/renamegroup(?:@\w+)?\s+([\s\S]+?)\s*=>\s*([\s\S]+)$/, async (msg: any, match: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const oldQuery = match[1].trim();
      const newName = match[2].trim();
      const resolved = await this.resolveGroup(oldQuery);
      if (resolved.candidates) {
        await this.sendMessageWithLog(chatId, `⚠️ Có nhiều nhóm khớp "${oldQuery}":\n${resolved.candidates.map(c => `• ${c.name}`).join('\n')}`);
        return;
      }
      if (!resolved.group) {
        await this.sendMessageWithLog(chatId, `❌ Không tìm thấy nhóm "${oldQuery}".`);
        return;
      }
      try {
        await this.shopsService.renameGroup(resolved.group.id, newName);
        await this.sendMessageWithLog(chatId, `✅ Đã đổi tên "${resolved.group.name}" → "${newName}".`);
      } catch (err) {
        await this.sendMessageWithLog(chatId, `❌ ${err.message}`);
      }
    });

    // ---- /delgroup <nhóm> [confirm] ----
    this.bot.onText(/^\/delgroup(?:@\w+)?\s+([\s\S]+)$/, async (msg: any, match: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      let arg = match[1].trim();
      const hasConfirm = /\s+confirm$/i.test(arg);
      if (hasConfirm) arg = arg.replace(/\s+confirm$/i, '').trim();

      const resolved = await this.resolveGroup(arg);
      if (resolved.candidates) {
        await this.sendMessageWithLog(chatId, `⚠️ Có nhiều nhóm khớp "${arg}":\n${resolved.candidates.map(c => `• ${c.name}`).join('\n')}`);
        return;
      }
      if (!resolved.group) {
        await this.sendMessageWithLog(chatId, `❌ Không tìm thấy nhóm "${arg}".`);
        return;
      }
      const g = resolved.group;

      if (!hasConfirm) {
        await this.sendMessageWithLog(
          chatId,
          `⚠️ Xóa nhóm "${g.name}" sẽ xóa luôn *${g.shops.length} shop* trong đó, không thể hoàn tác.\nGõ lại để xác nhận:\n\`/delgroup ${arg} confirm\``,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      try {
        await this.shopsService.deleteGroup(g.id);
        await this.sendMessageWithLog(chatId, `🗑️ Đã xóa nhóm "${g.name}" cùng ${g.shops.length} shop trong đó.`);
      } catch (err) {
        await this.sendMessageWithLog(chatId, `❌ ${err.message}`);
      }
    });

    // ---- /addshop <ID> | <Tên> | <SĐT> | <Nhóm> ----
    this.bot.onText(/^\/addshop(?:@\w+)?\s+([\s\S]+)$/, async (msg: any, match: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const parts = match[1].split('|').map((p: string) => p.trim());
      if (parts.length < 2 || !parts[0] || !parts[1]) {
        await this.sendMessageWithLog(
          chatId,
          '❌ Sai cú pháp. Dùng:\n`/addshop <ID> | <Tên Shop> | <SĐT> | <Tên Nhóm>`\n(SĐT và Tên Nhóm có thể bỏ trống)',
          { parse_mode: 'Markdown' }
        );
        return;
      }
      const [svCustomerId, name, phone, groupQuery] = parts;

      let groupId: number | null = null;
      if (groupQuery) {
        const resolved = await this.resolveGroup(groupQuery);
        if (resolved.candidates) {
          await this.sendMessageWithLog(chatId, `⚠️ Có nhiều nhóm khớp "${groupQuery}". Shop CHƯA được thêm:\n${resolved.candidates.map(c => `• ${c.name}`).join('\n')}`);
          return;
        }
        if (!resolved.group) {
          await this.sendMessageWithLog(chatId, `❌ Không tìm thấy nhóm "${groupQuery}". Shop CHƯA được thêm.`);
          return;
        }
        groupId = resolved.group.id;
      }

      try {
        await this.shopsService.upsertShop({ svCustomerId, name, phone: phone || '', groupId });
        await this.sendMessageWithLog(chatId, `✅ Đã thêm shop \`${svCustomerId}\` — ${name}${groupQuery ? ` vào nhóm "${groupQuery}"` : ' (chưa phân nhóm)'}.`, { parse_mode: 'Markdown' });
      } catch (err) {
        await this.sendMessageWithLog(chatId, `❌ ${err.message}`);
      }
    });

    // ---- /delshop <ID> ----
    this.bot.onText(/^\/delshop(?:@\w+)?\s+(\S+)$/, async (msg: any, match: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const id = match[1].trim();
      try {
        await this.shopsService.deleteShop(id);
        await this.sendMessageWithLog(chatId, `🗑️ Đã xóa shop ID \`${id}\`.`, { parse_mode: 'Markdown' });
      } catch (err) {
        await this.sendMessageWithLog(chatId, `❌ ${err.message}`);
      }
    });

    // ---- /moveshop <ID> => <Nhóm> ----
    this.bot.onText(/^\/moveshop(?:@\w+)?\s+(\S+)\s*=>\s*([\s\S]+)$/, async (msg: any, match: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const id = match[1].trim();
      const groupQuery = match[2].trim();

      const existing = (await this.shopsService.getShopsByIds([id]))[0];
      if (!existing) {
        await this.sendMessageWithLog(chatId, `❌ Không tìm thấy shop ID \`${id}\`.`, { parse_mode: 'Markdown' });
        return;
      }
      const resolved = await this.resolveGroup(groupQuery);
      if (resolved.candidates) {
        await this.sendMessageWithLog(chatId, `⚠️ Có nhiều nhóm khớp "${groupQuery}":\n${resolved.candidates.map(c => `• ${c.name}`).join('\n')}`);
        return;
      }
      if (!resolved.group) {
        await this.sendMessageWithLog(chatId, `❌ Không tìm thấy nhóm "${groupQuery}".`);
        return;
      }

      try {
        await this.shopsService.upsertShop({ ...existing, groupId: resolved.group.id });
        await this.sendMessageWithLog(chatId, `✅ Đã chuyển shop "${existing.name}" (\`${id}\`) sang nhóm "${resolved.group.name}".`, { parse_mode: 'Markdown' });
      } catch (err) {
        await this.sendMessageWithLog(chatId, `❌ ${err.message}`);
      }
    });

    // ---- /addshops <Tên Nhóm> \n ID | Tên | SĐT \n ... (BULK) ----
    this.bot.onText(/^\/addshops(?:@\w+)?(?:\s+([\s\S]+))?$/i, async (msg: any, match: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const raw = (match[1] || '').trim();
      if (!raw) {
        await this.sendMessageWithLog(
          chatId,
          '❌ Thiếu dữ liệu. Cú pháp (gửi trong 1 tin nhắn nhiều dòng):\n`/addshops <Tên Nhóm>`\n`ID | Tên Shop | SĐT`\n`ID | Tên Shop | SĐT`\n...',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const lines = raw.split('\n').map((l: string) => l.trim()).filter(Boolean);
      const groupQuery = lines.shift() || '';
      const bodyLines: string[] = lines;

      if (bodyLines.length === 0) {
        await this.sendMessageWithLog(chatId, '❌ Chưa có dòng shop nào. Mỗi dòng cần theo mẫu: `ID | Tên Shop | SĐT`', { parse_mode: 'Markdown' });
        return;
      }

      let groupId: number | null = null;
      let groupLabel = 'Chưa phân nhóm';
      if (groupQuery) {
        const resolved = await this.resolveGroup(groupQuery);
        if (resolved.candidates) {
          await this.sendMessageWithLog(chatId, `⚠️ Có nhiều nhóm khớp "${groupQuery}":\n${resolved.candidates.map(c => `• ${c.name}`).join('\n')}`);
          return;
        }
        if (!resolved.group) {
          await this.sendMessageWithLog(chatId, `❌ Không tìm thấy nhóm "${groupQuery}".`);
          return;
        }
        groupId = resolved.group.id;
        groupLabel = resolved.group.name;
      }

      const errors: string[] = [];
      let successCount = 0;
      for (const line of bodyLines) {
        const parts = line.split('|').map((p: string) => p.trim());
        const [svCustomerId, name, phone] = parts;
        if (!svCustomerId || !name) {
          errors.push(`Bỏ qua dòng sai cú pháp: "${line}"`);
          continue;
        }
        try {
          await this.shopsService.upsertShop({ svCustomerId, name, phone: phone || '', groupId });
          successCount++;
        } catch (err) {
          errors.push(`Lỗi dòng "${line}": ${err.message}`);
        }
      }

      let summary = `✅ Đã thêm *${successCount}/${bodyLines.length}* shop vào nhóm "${groupLabel}".`;
      if (errors.length > 0) summary += `\n\n⚠️ ${errors.slice(0, 10).join('\n⚠️ ')}`;
      if (errors.length > 10) summary += `\n_...và ${errors.length - 10} lỗi khác._`;
      await this.sendMessageWithLog(chatId, summary, { parse_mode: 'Markdown' });
    });

    // ---- /delshops <ID1,ID2,...> [confirm] (BULK) ----
    this.bot.onText(/^\/delshops(?:@\w+)?\s+([\s\S]+)$/, async (msg: any, match: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      let raw = match[1].trim();
      const hasConfirm = /\s+confirm$/i.test(raw);
      if (hasConfirm) raw = raw.replace(/\s+confirm$/i, '').trim();

      const ids = raw.split(/[,\n\s]+/).map((s: string) => s.trim()).filter(Boolean);
      if (ids.length === 0) {
        await this.sendMessageWithLog(chatId, '❌ Vui lòng liệt kê ID shop cần xóa, cách nhau bằng dấu phẩy.');
        return;
      }

      if (!hasConfirm) {
        await this.sendMessageWithLog(
          chatId,
          `⚠️ Sắp xóa *${ids.length} shop*: ${ids.join(', ')}\nKhông thể hoàn tác. Gõ lại kèm "confirm" ở cuối:\n\`/delshops ${raw} confirm\``,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      for (const id of ids) {
        await this.shopsService.deleteShop(id);
      }
      await this.sendMessageWithLog(chatId, `🗑️ Đã xóa ${ids.length} shop: ${ids.join(', ')}`);
    });

    // ---- /moveshops <ID1,ID2,...> => <Nhóm> (BULK) ----
    this.bot.onText(/^\/moveshops(?:@\w+)?\s+([^\n]+?)\s*=>\s*([\s\S]+)$/, async (msg: any, match: any) => {
      this.logInput(msg);
      const chatId = msg.chat.id;
      const idsRaw = match[1].trim();
      const groupQuery = match[2].trim();
      const ids = idsRaw.split(/[,\s]+/).map((s: string) => s.trim()).filter(Boolean);

      if (ids.length === 0) {
        await this.sendMessageWithLog(chatId, '❌ Vui lòng liệt kê ID shop cần chuyển, cách nhau bằng dấu phẩy.');
        return;
      }

      const resolved = await this.resolveGroup(groupQuery);
      if (resolved.candidates) {
        await this.sendMessageWithLog(chatId, `⚠️ Có nhiều nhóm khớp "${groupQuery}":\n${resolved.candidates.map(c => `• ${c.name}`).join('\n')}`);
        return;
      }
      if (!resolved.group) {
        await this.sendMessageWithLog(chatId, `❌ Không tìm thấy nhóm "${groupQuery}".`);
        return;
      }

      const existingShops = await this.shopsService.getShopsByIds(ids);
      const foundMap = new Map(existingShops.map(s => [s.svCustomerId, s]));
      const notFound: string[] = [];
      let moved = 0;
      for (const id of ids) {
        const shop = foundMap.get(id);
        if (!shop) {
          notFound.push(id);
          continue;
        }
        await this.shopsService.upsertShop({ ...shop, groupId: resolved.group.id });
        moved++;
      }

      let text = `✅ Đã chuyển *${moved}/${ids.length}* shop sang nhóm "${resolved.group.name}".`;
      if (notFound.length > 0) text += `\n⚠️ Không tìm thấy ID: ${notFound.join(', ')}`;
      await this.sendMessageWithLog(chatId, text, { parse_mode: 'Markdown' });
    });
  }

  private async sendStatusMessage(chatId: string | number) {
    const thresholdHours = this.settingsService.get('STUCK_THRESHOLD_HOURS', '24');
    const customerIds = this.settingsService.get('CUSTOMER_IDS', '28961,18363').split(',').map(s => s.trim()).filter(Boolean);
    const lookback = this.settingsService.get('DEFAULT_LOOKBACK_DAYS', '60');
    const maxPages = this.settingsService.get('MAX_SCAN_PAGES', '300');
    const cronEnabled = this.settingsService.get('CRON_ENABLED', 'true');
    const cronSchedule = this.settingsService.get('CRON_SCHEDULE', '0 8,14 * * *');
    const scanning = this.ordersService.isScanning();

    const groups = await this.shopsService.getGroupsWithShops();
    const idSet = new Set(customerIds);
    const activeGroup = groups.find(g => g.shops.length > 0 && g.shops.length === idSet.size && g.shops.every(s => idSet.has(s.svCustomerId)));

    const statusText =
`ℹ️ *TRẠNG THÁI HỆ THỐNG AUTO CHECK NESTJS*

- Đang quét: *${scanning ? '🟢 CÓ — gõ /cancel để dừng' : '⚪ Không'}*
- Ngưỡng giờ ngâm: *${thresholdHours}h*
- Thời gian quét mặc định: *${lookback} ngày*
- Giới hạn an toàn: *${maxPages} trang/lần*
- Đang lọc: *${activeGroup ? activeGroup.name : `${customerIds.length} shop tùy chỉnh`}* (${customerIds.length} shop)
- Chế độ Cronjob: *${cronEnabled === 'true' ? 'Đang BẬT ✅' : 'Đang TẮT ❌'}*
- Biểu thức Cron: \`${cronSchedule}\`

_Gõ /groups để xem danh sách nhóm shop._`;

    await this.sendMessageWithLog(chatId, statusText, { parse_mode: 'Markdown' });
  }

  // ============================================================================
  // REPLY KEYBOARD DISPATCHER: plain-text button labels + force-reply capture
  // ============================================================================

  private setupMenuHandlers() {
    if (!this.bot) return;
    const M = TelegramService.MENU;

    this.bot.on('message', async (msg: any) => {
      if (!msg.text) return;

      // 1) A reply to a force-reply prompt we sent earlier (findshop / newgroup free text)
      if (msg.reply_to_message && this.pendingPrompts.has(msg.reply_to_message.message_id)) {
        const pending = this.pendingPrompts.get(msg.reply_to_message.message_id)!;
        this.pendingPrompts.delete(msg.reply_to_message.message_id);
        this.logInput(msg);
        const chatId = msg.chat.id;
        const value = msg.text.trim();

        if (pending.type === 'findshop') {
          const found = await this.findShops(value);
          if (found.length === 0) {
            await this.sendMessageWithLog(chatId, `❌ Không tìm thấy shop nào khớp "${value}".`);
            return;
          }
          let text = `🔍 *Tìm thấy ${found.length} shop khớp "${value}":*\n\n`;
          found.slice(0, 25).forEach(s => {
            text += `• \`${s.svCustomerId}\` — ${s.name} _(${s.groupName})_\n`;
          });
          if (found.length > 25) text += `\n_...và ${found.length - 25} shop khác._`;
          await this.sendMessageWithLog(chatId, text, { parse_mode: 'Markdown' });
        } else if (pending.type === 'newgroup') {
          try {
            await this.shopsService.createGroup(value);
            await this.sendMessageWithLog(chatId, `✅ Đã tạo nhóm "${value}".`);
          } catch (err) {
            await this.sendMessageWithLog(chatId, `❌ ${err.message}`);
          }
        }
        return;
      }

      // 2) Slash commands are handled separately by onText - don't double-process here.
      if (msg.text.startsWith('/')) return;

      const chatId = msg.chat.id;

      switch (msg.text) {
        case M.CHECK_NOW:
          this.logInput(msg);
          await this.runCheckAndReport(chatId, {});
          break;

        case M.EXCEL_NOW:
          this.logInput(msg);
          await this.runExcelAndSend(chatId, {});
          break;

        case M.PICK_GROUP_CHECK: {
          this.logInput(msg);
          const groups = await this.shopsService.getGroupsWithShops();
          if (groups.length === 0) {
            await this.sendMessageWithLog(chatId, '📭 Chưa có nhóm shop nào. Dùng /newgroup <tên> để tạo nhóm đầu tiên.');
            break;
          }
          await this.sendMessageWithLog(chatId, '🏪 Chọn nhóm cần quét:', this.buildGroupsInlineKeyboard(groups, 'quick'));
          break;
        }

        case M.GROUP_LIST: {
          this.logInput(msg);
          const groups = await this.shopsService.getGroupsWithShops();
          if (groups.length === 0) {
            await this.sendMessageWithLog(chatId, '📭 Chưa có nhóm shop nào. Bấm nút bên dưới để tạo nhóm đầu tiên.', this.buildGroupsInlineKeyboard([], 'manage'));
            break;
          }
          await this.sendMessageWithLog(chatId, '📋 Chọn nhóm để xem/quản lý:', this.buildGroupsInlineKeyboard(groups, 'manage'));
          break;
        }

        case M.FIND_SHOP: {
          this.logInput(msg);
          const sent = await this.sendMessageWithLog(chatId, '🔎 Nhập tên, SĐT hoặc ID shop cần tìm:', {
            reply_markup: { force_reply: true, input_field_placeholder: 'VD: Hoàng, 0912345678, 18364' },
          });
          if (sent) this.pendingPrompts.set(sent.message_id, { type: 'findshop', chatId });
          break;
        }

        case M.CONFIG_QUICK:
          this.logInput(msg);
          await this.sendMessageWithLog(chatId, '⚙️ Cấu hình nhanh — bấm để đổi:', this.buildConfigMenuInlineKeyboard());
          break;

        case M.STATUS:
          this.logInput(msg);
          await this.sendStatusMessage(chatId);
          break;

        case M.CANCEL_SCAN: {
          this.logInput(msg);
          const stopped = this.ordersService.requestCancelScan();
          await this.sendMessageWithLog(chatId, stopped ? '🛑 Đã gửi yêu cầu dừng quét.' : 'ℹ️ Hiện không có phiên quét nào đang chạy.');
          break;
        }

        case M.HELP:
          this.logInput(msg);
          await this.sendMessageWithLog(chatId, '💡 Gõ /help để xem đầy đủ danh sách lệnh (bao gồm thao tác hàng loạt).', this.buildMainReplyKeyboard());
          break;

        default:
          break; // not a recognized menu label - ignore silently
      }
    });
  }

  // ============================================================================
  // INLINE KEYBOARD DISPATCHER: routes callback_query button presses
  // ============================================================================

  private setupCallbackHandlers() {
    if (!this.bot) return;

    this.bot.on('callback_query', async (query: any) => {
      const data: string = query.data || '';
      const chatId = query.message?.chat?.id;
      const messageId = query.message?.message_id;
      if (!chatId) return;

      this.logger.log(`--------------------------------------------------------------------------------`);
      this.logger.log(`📥 [TELEGRAM CALLBACK] Chat ID (${chatId}) bấm nút: "${data}"`);
      this.logger.log(`--------------------------------------------------------------------------------`);

      const [action, sub, param] = data.split(':');

      try {
        switch (action) {
          case 'qg': {
            // Quick-check: qg:<groupId> or qg:all
            await this.bot.answerCallbackQuery(query.id, { text: '🚀 Đang quét...' });
            if (sub === 'all') {
              const scope = await this.resolveScopeArg('all');
              if (!scope.ok) { await this.sendMessageWithLog(chatId, scope.message); break; }
              await this.runCheckAndReport(chatId, scope);
            } else {
              const groupId = parseInt(sub, 10);
              const groups = await this.shopsService.getGroupsWithShops();
              const group = groups.find(g => g.id === groupId);
              if (!group) { await this.sendMessageWithLog(chatId, '❌ Nhóm không còn tồn tại.'); break; }
              if (group.shops.length === 0) { await this.sendMessageWithLog(chatId, `⚠️ Nhóm "${group.name}" chưa có shop nào.`); break; }
              await this.runCheckAndReport(chatId, { customerIds: group.shops.map(s => s.svCustomerId), scopeLabel: group.name });
            }
            break;
          }

          case 'mg': {
            // Group management navigation: mg:list | mg:all | mg:new | mg:<id>
            if (sub === 'list') {
              const groups = await this.shopsService.getGroupsWithShops();
              await this.bot.answerCallbackQuery(query.id);
              await this.bot.editMessageText('📋 Chọn nhóm để xem/quản lý:', {
                chat_id: chatId, message_id: messageId, ...this.buildGroupsInlineKeyboard(groups, 'manage'),
              });
            } else if (sub === 'all') {
              await this.bot.answerCallbackQuery(query.id);
              const groups = await this.shopsService.getGroupsWithShops();
              const ungrouped = await this.shopsService.getUngroupedShops();
              const total = groups.reduce((s, g) => s + g.shops.length, 0) + ungrouped.length;
              await this.sendMessageWithLog(
                chatId,
                `🌐 *Tất cả shop*: ${total} shop trong hệ thống (${groups.length} nhóm + ${ungrouped.length} chưa phân nhóm).\nGõ /applyall rồi /check để quét toàn bộ.`,
                { parse_mode: 'Markdown' }
              );
            } else if (sub === 'new') {
              await this.bot.answerCallbackQuery(query.id);
              const sent = await this.sendMessageWithLog(chatId, '➕ Nhập tên nhóm mới:', {
                reply_markup: { force_reply: true, input_field_placeholder: 'VD: Nhóm 6: SPX' },
              });
              if (sent) this.pendingPrompts.set(sent.message_id, { type: 'newgroup', chatId });
            } else {
              const groupId = parseInt(sub, 10);
              const groups = await this.shopsService.getGroupsWithShops();
              const group = groups.find(g => g.id === groupId);
              await this.bot.answerCallbackQuery(query.id);
              if (!group) { await this.sendMessageWithLog(chatId, '❌ Nhóm không còn tồn tại (có thể đã bị xóa).'); break; }
              await this.bot.editMessageText(`🗂 *${group.name}* — ${group.shops.length} shop\n\nChọn thao tác:`, {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...this.buildGroupDetailInlineKeyboard(group.id),
              });
            }
            break;
          }

          case 'ga': {
            // Group actions: ga:check:<id> | ga:apply:<id> | ga:shops:<id> | ga:delask:<id> | ga:delyes:<id> | ga:delno:<id>
            const groupId = parseInt(param, 10);
            const groups = await this.shopsService.getGroupsWithShops();
            const group = groups.find(g => g.id === groupId);

            if (!group) {
              await this.bot.answerCallbackQuery(query.id, { text: '❌ Nhóm không còn tồn tại.', show_alert: true });
              break;
            }

            if (sub === 'check') {
              await this.bot.answerCallbackQuery(query.id, { text: '🚀 Đang quét...' });
              if (group.shops.length === 0) { await this.sendMessageWithLog(chatId, `⚠️ Nhóm "${group.name}" chưa có shop nào.`); break; }
              await this.runCheckAndReport(chatId, { customerIds: group.shops.map(s => s.svCustomerId), scopeLabel: group.name });
            } else if (sub === 'apply') {
              await this.bot.answerCallbackQuery(query.id);
              if (group.shops.length === 0) { await this.sendMessageWithLog(chatId, `⚠️ Nhóm "${group.name}" chưa có shop nào.`); break; }
              const customerIds = group.shops.map(s => s.svCustomerId).join(',');
              const labelsMap: Record<string, string> = {};
              group.shops.forEach(s => { labelsMap[s.svCustomerId] = s.name || s.svCustomerId; });
              await this.settingsService.set('CUSTOMER_IDS', customerIds);
              await this.settingsService.set('CUSTOMER_LABELS_JSON', JSON.stringify(labelsMap));
              await this.sendMessageWithLog(chatId, `✅ Đã áp dụng nhóm "${group.name}" (${group.shops.length} shop) làm bộ lọc chính thức.`);
            } else if (sub === 'shops') {
              await this.bot.answerCallbackQuery(query.id);
              let text = `🗂 *${group.name}* (${group.shops.length} shop)\n\n`;
              if (group.shops.length === 0) {
                text += '_(chưa có shop nào)_';
              } else {
                group.shops.forEach((s, i) => { text += `${i + 1}. \`${s.svCustomerId}\` — ${s.name}${s.phone ? ` (${s.phone})` : ''}\n`; });
              }
              await this.sendMessageWithLog(chatId, text, { parse_mode: 'Markdown' });
            } else if (sub === 'delask') {
              await this.bot.answerCallbackQuery(query.id);
              await this.bot.editMessageText(`⚠️ Xóa nhóm *"${group.name}"* sẽ xóa luôn *${group.shops.length} shop* trong đó.\nKhông thể hoàn tác!`, {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...this.buildDeleteConfirmInlineKeyboard(group.id),
              });
            } else if (sub === 'delyes') {
              await this.shopsService.deleteGroup(group.id);
              await this.bot.answerCallbackQuery(query.id, { text: '🗑️ Đã xóa nhóm.' });
              await this.bot.editMessageText(`🗑️ Đã xóa nhóm "${group.name}" cùng ${group.shops.length} shop.`, { chat_id: chatId, message_id: messageId });
            } else if (sub === 'delno') {
              await this.bot.answerCallbackQuery(query.id, { text: 'Đã hủy.' });
              await this.bot.editMessageText(`🗂 *${group.name}* — ${group.shops.length} shop\n\nChọn thao tác:`, {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...this.buildGroupDetailInlineKeyboard(group.id),
              });
            }
            break;
          }

          case 'cm': {
            // Config menu: cm:main | cm:th | cm:lb | cm:mp | cm:cron | cm:th:<v> | cm:lb:<v> | cm:mp:<v>
            if (sub === 'main') {
              await this.bot.answerCallbackQuery(query.id);
              await this.bot.editMessageText('⚙️ Cấu hình nhanh — bấm để đổi:', {
                chat_id: chatId, message_id: messageId, ...this.buildConfigMenuInlineKeyboard(),
              });
            } else if (sub === 'th' && !param) {
              await this.bot.answerCallbackQuery(query.id);
              await this.bot.editMessageText('⏱ Chọn ngưỡng ngâm mới:', {
                chat_id: chatId, message_id: messageId, ...this.buildValuePickerInlineKeyboard('th', ['12', '18', '24', '36', '48'], 'h'),
              });
            } else if (sub === 'lb' && !param) {
              await this.bot.answerCallbackQuery(query.id);
              await this.bot.editMessageText('📅 Chọn thời gian quét mặc định:', {
                chat_id: chatId, message_id: messageId, ...this.buildValuePickerInlineKeyboard('lb', ['7', '14', '21', '30', '60', '90', '120'], ' ngày'),
              });
            } else if (sub === 'mp' && !param) {
              await this.bot.answerCallbackQuery(query.id);
              await this.bot.editMessageText('🛡 Chọn giới hạn an toàn số trang/lần quét:', {
                chat_id: chatId, message_id: messageId, ...this.buildValuePickerInlineKeyboard('mp', ['100', '300', '500', '1000', '2000'], ''),
              });
            } else if (sub === 'cron') {
              const cronOn = this.settingsService.get('CRON_ENABLED', 'true') === 'true';
              await this.settingsService.set('CRON_ENABLED', cronOn ? 'false' : 'true');
              await this.bot.answerCallbackQuery(query.id, { text: cronOn ? '🔕 Đã tắt Cron' : '🔔 Đã bật Cron' });
              await this.bot.editMessageText('⚙️ Cấu hình nhanh — bấm để đổi:', {
                chat_id: chatId, message_id: messageId, ...this.buildConfigMenuInlineKeyboard(),
              });
            } else if (sub === 'th' && param) {
              await this.settingsService.set('STUCK_THRESHOLD_HOURS', param);
              await this.bot.answerCallbackQuery(query.id, { text: `✅ Đã đặt ngưỡng ngâm: ${param}h` });
              await this.bot.editMessageText('⚙️ Cấu hình nhanh — bấm để đổi:', {
                chat_id: chatId, message_id: messageId, ...this.buildConfigMenuInlineKeyboard(),
              });
            } else if (sub === 'lb' && param) {
              await this.settingsService.set('DEFAULT_LOOKBACK_DAYS', param);
              await this.bot.answerCallbackQuery(query.id, { text: `✅ Đã đặt thời gian quét: ${param} ngày` });
              await this.bot.editMessageText('⚙️ Cấu hình nhanh — bấm để đổi:', {
                chat_id: chatId, message_id: messageId, ...this.buildConfigMenuInlineKeyboard(),
              });
            } else if (sub === 'mp' && param) {
              await this.settingsService.set('MAX_SCAN_PAGES', param);
              await this.bot.answerCallbackQuery(query.id, { text: `✅ Đã đặt giới hạn: ${param} trang` });
              await this.bot.editMessageText('⚙️ Cấu hình nhanh — bấm để đổi:', {
                chat_id: chatId, message_id: messageId, ...this.buildConfigMenuInlineKeyboard(),
              });
            } else {
              await this.bot.answerCallbackQuery(query.id);
            }
            break;
          }

          default:
            await this.bot.answerCallbackQuery(query.id);
        }
      } catch (err) {
        this.logger.error(`Lỗi xử lý callback_query "${data}": ${err.message}`);
        try {
          await this.bot.answerCallbackQuery(query.id, { text: '❌ Có lỗi xảy ra.', show_alert: true });
        } catch (e) {}
      }
    });
  }

  async sendReportMessage(chatId: string | number, result: AnalysisResult, scopeLabel?: string) {
    if (!this.bot) return;

    const scopeSuffix = scopeLabel ? ` _(${scopeLabel})_` : '';

    if (result.stuckTotal === 0) {
      await this.sendMessageWithLog(chatId, `✅ *TÌNH TRẠNG TỐT*${scopeSuffix}: Hiện tại không có đơn nào bị ngâm quá ngưỡng!`, { parse_mode: 'Markdown' });
      return;
    }

    let summaryText = `⚠️ *CẢNH BÁO: PHÁT HIỆN ${result.stuckTotal} ĐƠN CẦN GIỤC HÀNH TRÌNH*${scopeSuffix}\n`;
    summaryText += `⏱️ _Ngưỡng ngâm: > ${result.thresholdHours} giờ_\n`;
    if (result.cancelled) summaryText += `🛑 _Phiên quét đã bị dừng giữa chừng theo yêu cầu — dữ liệu có thể chưa đầy đủ._\n`;
    if (result.truncated) summaryText += `⚠️ _Đã đạt giới hạn an toàn số trang — dữ liệu có thể chưa đầy đủ._\n`;
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
