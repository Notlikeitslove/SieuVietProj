import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as sqlite3 from 'sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface SettingItem {
  key: string;
  value: string;
  is_encrypted: boolean;
  updated_at: string;
}

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private db: sqlite3.Database;
  private settingsCache = new Map<string, { value: string; is_encrypted: boolean }>();

  // AES-256-GCM Encryption Key (Derived from master key)
  private readonly algorithm = 'aes-256-gcm';
  private readonly secretKey = crypto.scryptSync(
    process.env.ENCRYPTION_MASTER_KEY || 'svexpress-auto-check-secret-key-2026',
    'svexpress-salt',
    32
  );

  async onModuleInit() {
    await this.initDatabase();
    await this.seedFromEnvIfMissing();
  }

  private initDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const dbDir = path.join(__dirname, '../../../database');
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      const dbPath = path.join(dbDir, 'settings.sqlite');
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          this.logger.error(`❌ Lỗi mở database SQLite: ${err.message}`);
          return reject(err);
        }
        this.logger.log(`💾 Đã kết nối cơ sở dữ liệu SQLite: ${dbPath}`);

        this.db.run(
          `CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            is_encrypted INTEGER DEFAULT 0,
            updated_at TEXT
          )`,
          (createErr) => {
            if (createErr) return reject(createErr);
            this.loadCacheFromDb().then(resolve).catch(reject);
          }
        );
      });
    });
  }

  private loadCacheFromDb(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT key, value, is_encrypted FROM settings', (err, rows: any[]) => {
        if (err) return reject(err);
        this.settingsCache.clear();
        (rows || []).forEach(row => {
          this.settingsCache.set(row.key, {
            value: row.value,
            is_encrypted: Boolean(row.is_encrypted)
          });
        });
        this.logger.log(`✅ Đã nạp ${this.settingsCache.size} tham số cài đặt từ SQLite vào bộ nhớ.`);
        resolve();
      });
    });
  }

  private async seedFromEnvIfMissing() {
    const envSeeds: Array<{ key: string; envVal: string | undefined; defaultVal: string; isEncrypted: boolean }> = [
      { key: 'SV_ORDER_API_URL', envVal: process.env.SV_ORDER_API_URL, defaultVal: 'https://api.svexpress.vn/v1/order', isEncrypted: false },
      { key: 'SV_LOGIN_API_URL', envVal: process.env.SV_LOGIN_API_URL, defaultVal: 'https://api.svexpress.vn/v1/auth/login', isEncrypted: false },
      { key: 'SV_USERNAME', envVal: process.env.SV_USERNAME, defaultVal: '0972610009', isEncrypted: false },
      { key: 'SV_PASSWORD', envVal: process.env.SV_PASSWORD, defaultVal: 'HOANGSON1234@', isEncrypted: true },
      { key: 'SV_AUTH_TOKEN', envVal: process.env.SV_AUTH_TOKEN, defaultVal: '', isEncrypted: true },
      { key: 'STUCK_THRESHOLD_HOURS', envVal: process.env.STUCK_THRESHOLD_HOURS, defaultVal: '24', isEncrypted: false },
      { key: 'CUSTOMER_IDS', envVal: process.env.CUSTOMER_IDS, defaultVal: '28961,18363', isEncrypted: false },
      { key: 'CUSTOMER_LABELS_JSON', envVal: undefined, defaultVal: '{"28961":"Khách VIP 28961","18363":"Khách 18363"}', isEncrypted: false },
      { key: 'STATUS_ID', envVal: process.env.STATUS_ID, defaultVal: '4', isEncrypted: false },
      { key: 'STATUS_LABELS_JSON', envVal: undefined, defaultVal: '{"4":"Đang chuyển kho giao","2":"Đã lấy hàng","5":"Đang giao hàng","7":"Chờ xử lý / Hoàn hàng"}', isEncrypted: false },
      { key: 'DATE_FILTER_TYPE', envVal: process.env.DATE_FILTER_TYPE, defaultVal: 'pickup_at', isEncrypted: false },
      { key: 'WAREHOUSE_TYPE', envVal: process.env.WAREHOUSE_TYPE, defaultVal: '2', isEncrypted: false },
      { key: 'DEFAULT_LOOKBACK_DAYS', envVal: process.env.DEFAULT_LOOKBACK_DAYS, defaultVal: '60', isEncrypted: false },
      { key: 'PAGE_SIZE', envVal: process.env.PAGE_SIZE, defaultVal: '200', isEncrypted: false },
      { key: 'MAX_SCAN_PAGES', envVal: process.env.MAX_SCAN_PAGES, defaultVal: '300', isEncrypted: false },
      { key: 'PUBLIC_TRACKING_MIN_HOURS', envVal: process.env.PUBLIC_TRACKING_MIN_HOURS, defaultVal: '18', isEncrypted: false },
      { key: 'TRACKING_CONCURRENCY', envVal: process.env.TRACKING_CONCURRENCY, defaultVal: '8', isEncrypted: false },
      { key: 'TELEGRAM_BOT_TOKEN', envVal: process.env.TELEGRAM_BOT_TOKEN, defaultVal: '', isEncrypted: true },
      { key: 'TELEGRAM_CHAT_ID', envVal: process.env.TELEGRAM_CHAT_ID, defaultVal: '', isEncrypted: false },
      { key: 'TELEGRAM_POLLING', envVal: process.env.TELEGRAM_POLLING, defaultVal: 'false', isEncrypted: false },
      { key: 'CRON_ENABLED', envVal: process.env.CRON_ENABLED, defaultVal: 'true', isEncrypted: false },
      { key: 'CRON_SCHEDULE', envVal: process.env.CRON_SCHEDULE, defaultVal: '0 8,14 * * *', isEncrypted: false },
      { key: 'JT_PUBLIC_TRACKING_API_URL', envVal: process.env.JT_PUBLIC_TRACKING_API_URL, defaultVal: 'https://jtexpress.vn/vi/tracking?type=track&billcode={code}', isEncrypted: false },
      { key: 'SPX_PUBLIC_TRACKING_API_URL', envVal: process.env.SPX_PUBLIC_TRACKING_API_URL, defaultVal: 'https://spx.vn/shipment/order/open/order/get_order_info?spx_tn={code}&language_code=vi', isEncrypted: false },
    ];

    for (const seed of envSeeds) {
      if (!this.settingsCache.has(seed.key)) {
        const rawValue = (seed.envVal !== undefined && seed.envVal.trim() !== '') ? seed.envVal.trim() : seed.defaultVal;
        await this.set(seed.key, rawValue, seed.isEncrypted);
        this.logger.log(`🌱 Seeded key "${seed.key}" từ .env vào SQLite (Mã hóa: ${seed.isEncrypted})`);
      }
    }
  }

  // AES-256-GCM Encryption
  encrypt(text: string): string {
    if (!text) return '';
    try {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv(this.algorithm, this.secretKey, iv);
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag().toString('hex');
      return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    } catch (err) {
      this.logger.error(`Lỗi mã hóa string: ${err.message}`);
      return text;
    }
  }

  // AES-256-GCM Decryption
  decrypt(encryptedText: string): string {
    if (!encryptedText) return '';
    try {
      const parts = encryptedText.split(':');
      if (parts.length !== 3) return encryptedText; // Fallback plain string if not matching format
      const [ivHex, authTagHex, encrypted] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const decipher = crypto.createDecipheriv(this.algorithm, this.secretKey, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      return encryptedText;
    }
  }

  get(key: string, defaultValue: string = ''): string {
    const item = this.settingsCache.get(key);
    if (!item) return defaultValue;
    if (item.is_encrypted) {
      return this.decrypt(item.value);
    }
    return item.value;
  }

  getRaw(key: string): string {
    const item = this.settingsCache.get(key);
    return item ? item.value : '';
  }

  isEncrypted(key: string): boolean {
    const item = this.settingsCache.get(key);
    return item ? item.is_encrypted : false;
  }

  async set(key: string, value: string, isEncrypted = false): Promise<void> {
    const valToStore = isEncrypted ? this.encrypt(value) : value;
    const updatedAt = new Date().toISOString();

    return new Promise((resolve, reject) => {
      const sql = `INSERT INTO settings (key, value, is_encrypted, updated_at)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(key) DO UPDATE SET
                   value = excluded.value,
                   is_encrypted = excluded.is_encrypted,
                   updated_at = excluded.updated_at`;

      this.db.run(sql, [key, valToStore, isEncrypted ? 1 : 0, updatedAt], (err) => {
        if (err) {
          this.logger.error(`Lỗi ghi setting key "${key}" vào SQLite: ${err.message}`);
          return reject(err);
        }
        this.settingsCache.set(key, { value: valToStore, is_encrypted: isEncrypted });
        resolve();
      });
    });
  }

  async setMultiple(settingsMap: Record<string, { value: string; isEncrypted?: boolean }>): Promise<void> {
    for (const key of Object.keys(settingsMap)) {
      const item = settingsMap[key];
      if (item.value !== undefined) {
        await this.set(key, item.value, item.isEncrypted ?? false);
      }
    }
  }
}
