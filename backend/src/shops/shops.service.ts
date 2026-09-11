import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as sqlite3 from 'sqlite3';
import * as fs from 'fs';
import * as path from 'path';

export interface ShopRecord {
  svCustomerId: string;
  code: string;
  name: string;
  phone: string;
  username: string;
  queryLabel: string;
  groupId: number | null;
}

export interface ShopGroupRecord {
  id: number;
  name: string;
  createdAt: string;
  shops: ShopRecord[];
}

@Injectable()
export class ShopsService implements OnModuleInit {
  private readonly logger = new Logger(ShopsService.name);
  private db: sqlite3.Database;

  async onModuleInit() {
    await this.initDatabase();
    await this.seedFromJsonIfEmpty();
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
          this.logger.error(`❌ Lỗi mở database SQLite (shops): ${err.message}`);
          return reject(err);
        }

        this.db.serialize(() => {
          this.db.run(`CREATE TABLE IF NOT EXISTS shop_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT
          )`);
          this.db.run(
            `CREATE TABLE IF NOT EXISTS shops (
              sv_customer_id TEXT PRIMARY KEY,
              code TEXT,
              name TEXT,
              phone TEXT,
              username TEXT,
              query_label TEXT,
              group_id INTEGER,
              created_at TEXT,
              updated_at TEXT
            )`,
            (createErr) => {
              if (createErr) return reject(createErr);
              resolve();
            },
          );
        });
      });
    });
  }

  private run(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, (err) => (err ? reject(err) : resolve()));
    });
  }

  private get(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
  }

  private all(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
  }

  private mapShop = (s: any): ShopRecord => ({
    svCustomerId: s.sv_customer_id,
    code: s.code,
    name: s.name,
    phone: s.phone,
    username: s.username,
    queryLabel: s.query_label,
    groupId: s.group_id,
  });

  private async seedFromJsonIfEmpty() {
    const countRow = await this.get('SELECT COUNT(*) as c FROM shops');
    if (countRow && countRow.c > 0) return;

    const jsonPath = path.join(__dirname, '../../../y.json');
    if (!fs.existsSync(jsonPath)) return;

    try {
      const raw = fs.readFileSync(jsonPath, 'utf8');
      const parsed = JSON.parse(raw);
      const now = new Date().toISOString();
      let groupCount = 0;
      let shopCount = 0;

      for (const groupName of Object.keys(parsed)) {
        const groupId = await this.getOrCreateGroupId(groupName, now);
        groupCount++;
        const entries = Array.isArray(parsed[groupName]) ? parsed[groupName] : [];

        // The source export mixes two shapes in the same array: normal
        // { query, records: [...] } entries, and (for some rows) the raw
        // shop object dropped directly into the group array with no
        // "records" wrapper. Handle both so no shop gets silently skipped.
        const pending: Array<{ rec: any; queryLabel: string }> = [];
        for (const entry of entries) {
          if (entry && Array.isArray(entry.records)) {
            for (const rec of entry.records) {
              pending.push({ rec, queryLabel: entry.query || '' });
            }
          } else if (entry && entry.id !== undefined && entry.id !== null) {
            pending.push({ rec: entry, queryLabel: entry.name || '' });
          }
        }

        for (const { rec, queryLabel } of pending) {
          if (!rec || rec.id === undefined || rec.id === null) continue;
          await this.run(
            `INSERT INTO shops (sv_customer_id, code, name, phone, username, query_label, group_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(sv_customer_id) DO UPDATE SET
               code = excluded.code, name = excluded.name, phone = excluded.phone,
               username = excluded.username, query_label = excluded.query_label,
               group_id = excluded.group_id, updated_at = excluded.updated_at`,
            [
              String(rec.id),
              rec.code || '',
              rec.name || '',
              rec.phone || '',
              rec.username || '',
              queryLabel,
              groupId,
              now,
              now,
            ],
          );
          shopCount++;
        }
      }

      this.logger.log(`🌱 Đã nạp dữ liệu shop từ y.json vào SQLite: ${groupCount} nhóm, ${shopCount} shop.`);
    } catch (err) {
      this.logger.error(`Lỗi khi nạp dữ liệu shop từ y.json: ${err.message}`);
    }
  }

  private async getOrCreateGroupId(name: string, now: string): Promise<number> {
    await this.run(
      `INSERT INTO shop_groups (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING`,
      [name, now],
    );
    const row = await this.get('SELECT id FROM shop_groups WHERE name = ?', [name]);
    return row.id;
  }

  async getGroupsWithShops(): Promise<ShopGroupRecord[]> {
    const groups = await this.all('SELECT * FROM shop_groups ORDER BY id ASC');
    const shops = await this.all('SELECT * FROM shops ORDER BY name COLLATE NOCASE ASC');
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      createdAt: g.created_at,
      shops: shops.filter((s) => s.group_id === g.id).map(this.mapShop),
    }));
  }

  async getUngroupedShops(): Promise<ShopRecord[]> {
    const shops = await this.all('SELECT * FROM shops WHERE group_id IS NULL ORDER BY name COLLATE NOCASE ASC');
    return shops.map(this.mapShop);
  }

  async createGroup(name: string): Promise<number> {
    const trimmed = (name || '').trim();
    if (!trimmed) throw new Error('Tên nhóm không được để trống');
    const existing = await this.get('SELECT id FROM shop_groups WHERE name = ?', [trimmed]);
    if (existing) throw new Error('Tên nhóm này đã tồn tại');
    const now = new Date().toISOString();
    await this.run('INSERT INTO shop_groups (name, created_at) VALUES (?, ?)', [trimmed, now]);
    const row = await this.get('SELECT id FROM shop_groups WHERE name = ?', [trimmed]);
    return row.id;
  }

  async renameGroup(id: number, name: string): Promise<void> {
    const trimmed = (name || '').trim();
    if (!trimmed) throw new Error('Tên nhóm không được để trống');
    const existing = await this.get('SELECT id FROM shop_groups WHERE name = ? AND id != ?', [trimmed, id]);
    if (existing) throw new Error('Tên nhóm này đã tồn tại');
    await this.run('UPDATE shop_groups SET name = ? WHERE id = ?', [trimmed, id]);
  }

  async deleteGroup(id: number): Promise<void> {
    await this.run('DELETE FROM shops WHERE group_id = ?', [id]);
    await this.run('DELETE FROM shop_groups WHERE id = ?', [id]);
  }

  async upsertShop(data: Partial<ShopRecord>): Promise<void> {
    const svCustomerId = String(data.svCustomerId || '').trim();
    if (!svCustomerId) throw new Error('ID Khách Hàng (svCustomerId) không được để trống');
    const now = new Date().toISOString();
    const groupId = data.groupId === undefined || data.groupId === null || (data.groupId as any) === '' ? null : Number(data.groupId);

    const existing = await this.get('SELECT sv_customer_id FROM shops WHERE sv_customer_id = ?', [svCustomerId]);
    if (existing) {
      await this.run(
        `UPDATE shops SET code = ?, name = ?, phone = ?, username = ?, query_label = ?, group_id = ?, updated_at = ? WHERE sv_customer_id = ?`,
        [data.code || '', data.name || '', data.phone || '', data.username || '', data.queryLabel || '', groupId, now, svCustomerId],
      );
    } else {
      await this.run(
        `INSERT INTO shops (sv_customer_id, code, name, phone, username, query_label, group_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [svCustomerId, data.code || '', data.name || '', data.phone || '', data.username || '', data.queryLabel || '', groupId, now, now],
      );
    }
  }

  async deleteShop(svCustomerId: string): Promise<void> {
    await this.run('DELETE FROM shops WHERE sv_customer_id = ?', [svCustomerId]);
  }

  async getGroupShopIds(groupId: number): Promise<string[]> {
    const rows = await this.all('SELECT sv_customer_id FROM shops WHERE group_id = ?', [groupId]);
    return rows.map((r) => r.sv_customer_id);
  }

  async getShopsByIds(ids: string[]): Promise<ShopRecord[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = await this.all(`SELECT * FROM shops WHERE sv_customer_id IN (${placeholders})`, ids);
    return rows.map(this.mapShop);
  }
}
