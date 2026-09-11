import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { AuthService } from '../auth/auth.service';
import { TrackingService, TrackingResult } from '../tracking/tracking.service';

export interface StuckOrder {
  svCode: string;
  partnerCode: string;
  partnerName: string;
  customerName: string;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  statusName: string;
  updatedAt: string;
  hoursStuck: number;
  lastNote: string;
  publicTracking?: TrackingResult | null;
}

export interface AnalysisResult {
  scannedTotal: number;
  stuckTotal: number;
  thresholdHours: number;
  timestamp: string;
  partnerSummary: Record<string, { count: number; maxHoursStuck: number; orders: StuckOrder[] }>;
  stuckOrders: StuckOrder[];
  cancelled?: boolean;
  truncated?: boolean;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private scanAbortController: AbortController | null = null;
  private cancelRequested = false;
  private lastScanCancelled = false;
  private lastScanTruncated = false;
  private isBusy = false;
  private currentScanPromise: Promise<AnalysisResult> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
    private readonly authService: AuthService,
    private readonly trackingService: TrackingService,
  ) {}

  requestCancelScan(): boolean {
    if (!this.isBusy) return false;
    this.cancelRequested = true;
    this.scanAbortController?.abort();
    this.logger.warn('🛑 Đã nhận yêu cầu DỪNG quét đơn hàng từ người dùng.');
    return true;
  }

  isScanning(): boolean {
    return this.isBusy;
  }

  async fetchOrdersFromApi(options: any = {}): Promise<any[]> {
    this.scanAbortController = new AbortController();

    let token = await this.authService.getToken();

    if (!token) {
      this.scanAbortController = null;
      throw new Error('Chưa có Token Authorization. Vui lòng dán SV_AUTH_TOKEN hoặc điền SV_USERNAME & SV_PASSWORD vào cài đặt');
    }

    const now = new Date();
    const dateTo = options.dateTo || now.toISOString();
    
    const defaultLookback = parseFloat(this.settingsService.get('DEFAULT_LOOKBACK_DAYS', '60')) || 60;
    const rawLookback = options.lookbackDays !== undefined ? parseFloat(options.lookbackDays) : NaN;
    const lookbackDays = !isNaN(rawLookback) && rawLookback > 0 ? rawLookback : defaultLookback;
    const dateFromObj = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    const dateFrom = options.dateFrom || dateFromObj.toISOString();

    const customerIdsSetting = this.settingsService.get('CUSTOMER_IDS', '28961,18363');
    const customerIds = options.customerIds || customerIdsSetting.split(',').map(s => s.trim()).filter(Boolean);
    const statusSetting = String(options.statusId || this.settingsService.get('STATUS_ID', '4'));
    const statusIds = statusSetting.split(',').map(s => s.trim()).filter(Boolean);
    const typeFilterDate = options.typeFilterDate || this.settingsService.get('DATE_FILTER_TYPE', 'pickup_at');
    const warehouseType = options.warehouseType || (parseInt(this.settingsService.get('WAREHOUSE_TYPE', '2'), 10) || 2);
    const orderApiUrl = this.settingsService.get('SV_ORDER_API_URL', 'https://api.svexpress.vn/v1/order');

    let allOrders: any[] = [];
    let page = 1;
    const defaultPageSize = parseInt(this.settingsService.get('PAGE_SIZE', '200'), 10) || 200;
    const pageSize = options.pageSize ? parseInt(options.pageSize, 10) : defaultPageSize;
    const maxPages = parseInt(this.settingsService.get('MAX_SCAN_PAGES', '300'), 10) || 300;
    let hasMore = true;

    this.logger.log(`--------------------------------------------------------------------------------`);
    this.logger.log(`🚀 [GHSV API] Đang kết nối quét danh sách đơn hàng từ SV Express...`);
    this.logger.log(`   🗓️  Khoảng thời gian lọc : Từ ${dateFrom} -> Đến ${dateTo} (${lookbackDays} ngày)`);
    this.logger.log(`   📋 Tham số kiểm soát gửi đi (Query Params):`);
    this.logger.log(`      ├─ Số đơn trên trang (pageSize)     : ${pageSize}`);
    this.logger.log(`      ├─ Giới hạn an toàn (maxPages)     : ${maxPages} trang (~${maxPages * pageSize} đơn)`);
    this.logger.log(`      ├─ Loại ngày lọc (typeFilterDate)  : ${typeFilterDate}`);
    this.logger.log(`      ├─ Đơn quản lý (is_manage_order)   : true`);
    this.logger.log(`      ├─ Loại kho (ware_house_type)     : ${warehouseType}`);
    this.logger.log(`      ├─ Tiêu chí sắp xếp (sort)         : ${typeFilterDate}=DESC`);
    this.logger.log(`      ├─ ID Khách hàng (id_customer)     : ${customerIds.join(', ')}`);
    this.logger.log(`      └─ ID Trạng thái (id_status)       : ${statusIds.join(', ')}`);
    this.logger.log(`--------------------------------------------------------------------------------`);

    while (hasMore) {
      if (this.cancelRequested) {
        this.logger.warn(`🛑 Dừng quét theo yêu cầu người dùng trước trang ${page}. Đã tải được ${allOrders.length} đơn.`);
        this.lastScanCancelled = true;
        break;
      }

      if (page > maxPages) {
        this.logger.warn(`⚠️ Đã đạt giới hạn an toàn ${maxPages} trang (${allOrders.length} đơn). Dừng tải để tránh quét vô hạn.`);
        this.logger.warn(`   💡 Muốn quét đầy đủ hơn: thu hẹp "Thời gian quét" / ID Khách Hàng, hoặc tăng "Giới hạn số trang tối đa" trong Cài Đặt.`);
        this.lastScanTruncated = true;
        break;
      }

      const queryParams = new URLSearchParams();
      queryParams.append('pageSize', pageSize.toString());
      queryParams.append('page', page.toString());
      queryParams.append('dateFrom', dateFrom);
      queryParams.append('dateTo', dateTo);
      queryParams.append('typeFilterDate', typeFilterDate);
      queryParams.append('is_manage_order', 'true');
      queryParams.append('ware_house_type', warehouseType.toString());
      queryParams.append('sort', `${typeFilterDate}=DESC`);

      customerIds.forEach((cid: string) => {
        queryParams.append('filter', `id_customer=${cid}`);
      });
      
      statusIds.forEach((sid: string) => {
        queryParams.append('filter', `id_status=${sid}`);
      });

      const apiUrl = `${orderApiUrl}?${queryParams.toString()}`;
      this.logger.log(`   📄 [Đang lấy Trang ${page}]: pageSize=${pageSize} | page=${page}`);

      try {
        const response = await axios.get(apiUrl, {
          headers: { Authorization: token, Accept: 'application/json' },
          timeout: 20000,
          signal: this.scanAbortController?.signal
        });

        const data = response.data;
        const items = Array.isArray(data) ? data : (data?.data || data?.rows || []);

        if (items.length > 0) {
          allOrders = allOrders.concat(items);
          this.logger.log(`   📄 [Trang ${page}]: Tải về thành công ${items.length} đơn hàng.`);

          if (items.length < pageSize) {
            this.logger.log(`   🏁 Trang ${page} lấy ${items.length} đơn (< ${pageSize}) -> Đã lấy hết toàn bộ đơn hàng.`);
            hasMore = false;
          } else {
            page++;
          }
        } else {
          this.logger.log(`   🏁 Trang ${page} không có đơn hàng -> Hoàn tất quá trình tải.`);
          hasMore = false;
        }
      } catch (err) {
        if (axios.isCancel(err) || this.cancelRequested) {
          this.logger.warn(`🛑 Đã dừng quét theo yêu cầu người dùng tại trang ${page}. Tổng đã tải: ${allOrders.length} đơn.`);
          this.lastScanCancelled = true;
          hasMore = false;
          break;
        }

        if (err.response?.status === 401) {
          this.logger.warn('⚠️ Nhận được lỗi 401 Unauthorized từ API. Đang tự động đăng nhập lại...');
          token = await this.authService.getToken(true);
          if (token) {
            try {
              const retryRes = await axios.get(apiUrl, {
                headers: { Authorization: token, Accept: 'application/json' },
                timeout: 20000,
                signal: this.scanAbortController?.signal
              });
              const data = retryRes.data;
              const items = Array.isArray(data) ? data : (data?.data || data?.rows || []);
              if (items.length > 0) {
                allOrders = allOrders.concat(items);
                this.logger.log(`   📄 [Trang ${page} - Retry]: Tải lại thành công ${items.length} đơn.`);
                if (items.length < pageSize) hasMore = false; else page++;
                continue;
              }
            } catch (retryErr) {
              if (axios.isCancel(retryErr) || this.cancelRequested) {
                this.logger.warn(`🛑 Đã dừng quét theo yêu cầu người dùng. Tổng đã tải: ${allOrders.length} đơn.`);
                this.lastScanCancelled = true;
                hasMore = false;
                break;
              }
              this.scanAbortController = null;
              throw new Error(`❌ Đã đăng nhập lại nhưng vẫn thất bại khi kết nối API: ${retryErr.message}`);
            }
          }
        }
        this.scanAbortController = null;
        throw new Error(`❌ Lỗi kết nối API SV Express: ${err.message}`);
      }
    }

    this.scanAbortController = null;
    if (this.lastScanCancelled) {
      this.logger.warn(`🛑 [GHSV API DỪNG SỚM] Đã dừng theo yêu cầu. Tổng cộng đã tải được ${allOrders.length} đơn hàng qua ${page} trang trước khi dừng.`);
    } else if (this.lastScanTruncated) {
      this.logger.warn(`⚠️ [GHSV API BỊ CẮT BỚT] Đã đạt giới hạn an toàn. Tổng cộng đã tải được ${allOrders.length} đơn hàng qua ${page - 1} trang (có thể chưa đầy đủ).`);
    } else {
      this.logger.log(`✅ [GHSV API HOÀN TẤT] Tổng cộng đã tải về ${allOrders.length} đơn hàng qua ${page} trang.`);
    }
    return allOrders;
  }

  async analyzeStuckOrders(options: any = {}): Promise<AnalysisResult> {
    // Scan state (scanAbortController, cancelRequested, ...) is shared instance state,
    // not per-call - two overlapping scans (e.g. React StrictMode's dev double-effect,
    // or a user re-triggering a scan before the last one finished) would otherwise race
    // and corrupt each other's cancel/abort tracking. Policy: only ONE scan runs at a
    // time - a new request pre-empts (cancels) whatever is currently running so the
    // freshest request always wins, instead of piling up parallel scans.
    if (this.isBusy && this.currentScanPromise) {
      this.logger.warn('🔄 Có yêu cầu quét mới trong khi phiên trước chưa xong -> hủy phiên cũ, ưu tiên xử lý phiên mới nhất.');
      this.cancelRequested = true;
      this.scanAbortController?.abort();
      try {
        await this.currentScanPromise;
      } catch {
        // The pre-empted scan may settle in an unexpected way - irrelevant, we're superseding it.
      }
    }

    this.isBusy = true;
    this.cancelRequested = false;
    this.lastScanCancelled = false;
    this.lastScanTruncated = false;

    const scanPromise = this.runAnalysis(options).finally(() => {
      this.isBusy = false;
      this.scanAbortController = null;
      if (this.currentScanPromise === scanPromise) {
        this.currentScanPromise = null;
      }
    });
    this.currentScanPromise = scanPromise;
    return scanPromise;
  }

  private async runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
    let cursor = 0;
    const workerCount = Math.max(1, Math.min(limit, items.length));
    const runners = new Array(workerCount).fill(0).map(async () => {
      while (cursor < items.length) {
        if (this.cancelRequested) return;
        const item = items[cursor++];
        await worker(item);
      }
    });
    await Promise.all(runners);
  }

  private async runAnalysis(options: any = {}): Promise<AnalysisResult> {
    const defaultThreshold = parseFloat(this.settingsService.get('STUCK_THRESHOLD_HOURS', '24')) || 24;
    const thresholdHours = options.thresholdHours || defaultThreshold;
    const enablePublicTracking = options.enablePublicTracking ?? true;
    // Public tracking does a live external HTTP call per order (J&T/SPX). Frontend now
    // always fetches at a low baseline threshold so it can filter higher thresholds
    // client-side without re-scanning - but that would otherwise force tracking lookups
    // for far more orders than before. Gate tracking to orders that are ACTUALLY worth
    // the lookup cost, independent of the low fetch threshold.
    const trackingMinHours = parseFloat(this.settingsService.get('PUBLIC_TRACKING_MIN_HOURS', '18')) || 18;

    this.logger.log(`⚡ [BẮT ĐẦU ĐÁNH GIÁ ĐƠN HÀNG] Điều kiện lọc: Ngâm >= ${thresholdHours} giờ | Care Public Tracking: ${enablePublicTracking ? `BẬT (>= ${trackingMinHours}h)` : 'TẮT'}`);

    const rawOrders = await this.fetchOrdersFromApi(options);
    const now = new Date();

    const stuckOrders: StuckOrder[] = [];
    const partnerSummary: Record<string, { count: number; maxHoursStuck: number; orders: StuckOrder[] }> = {};

    this.logger.log(`🔍 Bắt đầu kiểm tra chi tiết từng đơn hàng trong tổng số ${rawOrders.length} đơn đã tải về...`);

    let passedCount = 0;
    let failedCount = 0;

    for (const item of rawOrders) {
      if (this.cancelRequested) {
        this.lastScanCancelled = true;
        this.logger.warn(`🛑 Dừng phân tích đơn theo yêu cầu người dùng. Đã xử lý ${passedCount + failedCount}/${rawOrders.length} đơn tải về.`);
        break;
      }
      const svCode = item.code || item.order_code || 'N/A';
      const partnerCode = item.partner_order_code || item.tracking_code || 'N/A';
      const rawPartner = item.partner?.partner_name || item.partner_name || item.partner?.name || 'Chưa xác định';
      let partnerName = rawPartner;
      const pUpper = rawPartner.toUpperCase();
      if (pUpper.includes('JAT') || pUpper.includes('J&T') || pUpper === 'JT') {
        partnerName = 'J&T';
      } else if (pUpper.includes('SPX') || pUpper.includes('SHOPEE')) {
        partnerName = 'SPX';
      }
      const customerName = item.customer?.name || item.customer_name || 'N/A';
      const receiverName = item.to_infomation?.name || item.receiver_name || item.to_name || 'N/A';
      const receiverPhone = item.to_infomation?.phone || item.receiver_phone || item.to_phone || '';
      const receiverAddress = item.to_infomation?.address || item.receiver_address || '';
      const statusName = item.status?.name || item.status_name || 'Đang chuyển kho giao';

      const updatedAtStr = item.updatedAt || item.updated_at;
      let updatedAt = new Date(updatedAtStr);
      if (isNaN(updatedAt.getTime())) updatedAt = new Date();

      const diffMs = now.getTime() - updatedAt.getTime();
      const hoursStuck = Math.max(0, diffMs / (1000 * 60 * 60));

      let lastNote = '';
      if (item.note_private) {
        const lines = item.note_private.toString().split('\n').map((l: string) => l.trim()).filter(Boolean);
        lastNote = lines.length > 0 ? lines[lines.length - 1] : '';
      }

      if (hoursStuck >= thresholdHours) {
        passedCount++;
        const orderData: StuckOrder = {
          svCode,
          partnerCode,
          partnerName,
          customerName,
          receiverName,
          receiverPhone,
          receiverAddress,
          statusName,
          updatedAt: updatedAt.toISOString(),
          hoursStuck: parseFloat(hoursStuck.toFixed(1)),
          lastNote,
          publicTracking: null
        };

        stuckOrders.push(orderData);

        if (!partnerSummary[partnerName]) {
          partnerSummary[partnerName] = { count: 0, maxHoursStuck: 0, orders: [] };
        }
        partnerSummary[partnerName].count += 1;
        partnerSummary[partnerName].maxHoursStuck = Math.max(partnerSummary[partnerName].maxHoursStuck, orderData.hoursStuck);
        partnerSummary[partnerName].orders.push(orderData);
      } else {
        failedCount++;
      }
    }

    // Public tracking = 1 external HTTP call per order (J&T/SPX). Running these
    // sequentially with thousands of stuck orders can take 5-10+ minutes and blow
    // past any reverse-proxy/browser timeout, making the dashboard look like it
    // "never loads". Run them concurrently (bounded) instead.
    if (enablePublicTracking) {
      const candidates = stuckOrders.filter(o => o.partnerCode !== 'N/A' && o.hoursStuck >= trackingMinHours);
      const concurrency = parseInt(this.settingsService.get('TRACKING_CONCURRENCY', '8'), 10) || 8;
      if (candidates.length > 0) {
        this.logger.log(`🌐 Đang tra cứu hành trình công khai cho ${candidates.length} đơn (song song ${concurrency} luồng)...`);
        const trackingStart = Date.now();

        await this.runWithConcurrency(candidates, concurrency, async (orderData) => {
          orderData.publicTracking = await this.trackingService.fetchPublicTrackingInfo(orderData.partnerName, orderData.partnerCode);
          if (orderData.publicTracking) {
            if (orderData.publicTracking.statusTimestamp) {
              const pubHours = Math.max(0, (now.getTime() - orderData.publicTracking.statusTimestamp) / (3600 * 1000));
              orderData.publicTracking.hoursSinceLastUpdate = parseFloat(pubHours.toFixed(1));
              orderData.publicTracking.isOutdated = pubHours >= 24;
            } else {
              orderData.publicTracking.hoursSinceLastUpdate = orderData.hoursStuck;
              orderData.publicTracking.isOutdated = orderData.hoursStuck >= 24;
            }
          }
        });

        const trackingSecs = ((Date.now() - trackingStart) / 1000).toFixed(1);
        if (this.cancelRequested) {
          this.lastScanCancelled = true;
          this.logger.warn(`🛑 Dừng tra cứu hành trình theo yêu cầu người dùng sau ${trackingSecs}s.`);
        } else {
          this.logger.log(`✅ Hoàn tất tra cứu hành trình ${candidates.length} đơn trong ${trackingSecs}s.`);
        }
      }
    }

    const partnerLogStr = Object.keys(partnerSummary)
      .map(p => `${p}: ${partnerSummary[p].count} đơn (ngâm lâu nhất: ${partnerSummary[p].maxHoursStuck}h)`)
      .join(' | ');

    this.logger.log(`--------------------------------------------------------------------------------`);
    this.logger.log(`📊 [THỐNG KÊ CHI TIẾT PHÂN TÍCH ĐƠN HÀNG]`);
    this.logger.log(`   ├─ 📥 Tổng số đơn đã lấy từ API: ${rawOrders.length} đơn`);
    this.logger.log(`   ├─ 🚨 ĐÁP ỨNG ĐIỀU KIỆN (Bị ngâm >= ${thresholdHours}h): ${passedCount} đơn (Đã đưa vào báo cáo)`);
    this.logger.log(`   └─ ✅ KHÔNG ĐÁP ỨNG (Ngâm < ${thresholdHours}h): ${failedCount} đơn (Đã bỏ qua)`);
    if (passedCount > 0) {
      this.logger.log(`   📌 Chi tiết theo NVC: ${partnerLogStr}`);
    }
    this.logger.log(`--------------------------------------------------------------------------------`);

    stuckOrders.sort((a, b) => {
      if (a.partnerName !== b.partnerName) return a.partnerName.localeCompare(b.partnerName);
      return b.hoursStuck - a.hoursStuck;
    });

    return {
      scannedTotal: rawOrders.length,
      stuckTotal: stuckOrders.length,
      thresholdHours,
      timestamp: new Date().toISOString(),
      partnerSummary,
      stuckOrders,
      cancelled: this.lastScanCancelled,
      truncated: this.lastScanTruncated
    };
  }

  async exportOrdersToExcel(analysisResult: AnalysisResult): Promise<string> {
    const exportsDir = path.join(__dirname, '../../../exports');
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SV Express Auto Check NestJS';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Danh Sách Đơn Cần Giục', {
      pageSetup: { paperSize: 9, orientation: 'landscape' }
    });

    worksheet.mergeCells('A1:K1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `DANH SÁCH ĐƠN HÀNG CẦN GIỤC NVC (NGÂM SỐ GIỜ >= ${analysisResult.thresholdHours}H)`;
    titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(1).height = 30;

    worksheet.mergeCells('A2:K2');
    const subTitleCell = worksheet.getCell('A2');
    const dateStr = new Date(analysisResult.timestamp).toLocaleString('vi-VN');
    subTitleCell.value = `Thời gian xuất báo cáo: ${dateStr} | Tổng đơn ngâm: ${analysisResult.stuckTotal} đơn`;
    subTitleCell.font = { name: 'Arial', size: 10, italic: true };
    subTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(2).height = 20;

    worksheet.addRow([]);

    const headers = [
      'STT', 'Nhà Vận Chuyển', 'Mã GHSV', 'Mã Vận Đơn', 'Giờ Bị Ngâm (Giờ)',
      'Bưu Cục / Trạm Giữ Hàng', 'Khách Gửi', 'Người Nhận', 'Số Điện Thoại',
      'Trạng Thái GHSV', 'Ghi Chú Cuối'
    ];

    const headerRow = worksheet.addRow(headers);
    headerRow.height = 25;
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFBFBFBF' } },
        bottom: { style: 'medium', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FFBFBFBF' } },
        right: { style: 'thin', color: { argb: 'FFBFBFBF' } }
      };
    });

    analysisResult.stuckOrders.forEach((order, index) => {
      let stationInfo = 'Chưa kiểm tra';
      if (order.publicTracking) {
        stationInfo = order.publicTracking.station || order.publicTracking.description || 'N/A';
      }

      const rowData = [
        index + 1, order.partnerName, order.svCode, order.partnerCode, order.hoursStuck,
        stationInfo, order.customerName, order.receiverName, order.receiverPhone,
        order.statusName, order.lastNote
      ];

      const row = worksheet.addRow(rowData);
      row.height = 22;

      let rowBgColor = index % 2 === 0 ? 'F9FAFB' : 'FFFFFF';
      if (order.hoursStuck >= 48) rowBgColor = 'FCE8E6';
      else if (order.hoursStuck >= 24) rowBgColor = 'FEF7E0';

      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'Arial', size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${rowBgColor}` } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
        };

        if (colNumber === 1 || colNumber === 5) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else if (colNumber === 2 || colNumber === 3 || colNumber === 4) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.font = { name: 'Arial', size: 10, bold: true };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }
      });
    });

    worksheet.columns.forEach((column) => {
      let maxLength = 10;
      column.eachCell({ includeEmpty: false }, (cell) => {
        const cellLen = cell.value ? cell.value.toString().length : 0;
        if (cellLen > maxLength) maxLength = cellLen;
      });
      column.width = Math.min(Math.max(maxLength + 4, 12), 45);
    });

    const pad = (n: number) => n.toString().padStart(2, '0');
    const now = new Date();
    const dateTag = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const fileName = `Dons_Can_Giuc_${dateTag}.xlsx`;
    const filePath = path.join(exportsDir, fileName);

    await workbook.xlsx.writeFile(filePath);
    return filePath;
  }
}
