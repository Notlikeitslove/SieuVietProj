import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface TrackingResult {
  partner: string;
  billCode: string;
  station: string;
  fullAddress?: string;
  statusName: string;
  description: string;
  statusTime?: string;
  statusTimestamp?: number;
  isOutdated?: boolean;
  hoursSinceLastUpdate?: number;
  rawUrl?: string;
}

@Injectable()
export class TrackingService {
  constructor(private readonly configService: ConfigService) {}

  async fetchPublicTrackingInfo(partnerName: string, billCode: string): Promise<TrackingResult | null> {
    if (!billCode || billCode === 'N/A' || !partnerName) return null;

    const normalized = partnerName.toUpperCase();

    if (normalized.includes('SPX') || normalized.includes('SHOPEE')) {
      return await this.fetchSPXTracking(billCode);
    } else if (normalized.includes('J&T') || normalized.includes('JT') || normalized.includes('JAT')) {
      return await this.fetchJTTracking(billCode);
    }

    return null;
  }

  async fetchSPXTracking(spxTn: string): Promise<TrackingResult | null> {
    const apis = this.configService.get('carrierPublicApis');
    const baseUrl = apis?.['SPX'] || 'https://spx.vn/shipment/order/open/order/get_order_info?spx_tn={code}&language_code=vi';
    const url = baseUrl.replace('{code}', encodeURIComponent(spxTn));

    try {
      const res = await axios.get(url, {
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Referer': `https://spx.vn/track?${spxTn}`
        }
      });

      const data = res.data;
      if (data?.retcode === 0 && data?.data?.sls_tracking_info?.records) {
        const records = data.data.sls_tracking_info.records;
        if (Array.isArray(records) && records.length > 0) {
          const latest = records[0];
          
          const station = latest.current_location?.location_name || 
                          latest.next_location?.location_name || 
                          'N/A';

          const fullAddress = latest.current_location?.full_address || 
                              latest.next_location?.full_address || 
                              '';

          const description = latest.description || 
                              latest.seller_description || 
                              latest.buyer_description || 
                              '';

          const statusTimestamp = latest.actual_time ? latest.actual_time * 1000 : null;
          const timeStr = statusTimestamp 
            ? new Date(statusTimestamp).toLocaleString('vi-VN') 
            : 'N/A';

          const hoursSinceLastUpdate = statusTimestamp 
            ? parseFloat(((Date.now() - statusTimestamp) / (3600 * 1000)).toFixed(1)) 
            : null;
          const isOutdated = hoursSinceLastUpdate !== null ? hoursSinceLastUpdate >= 24 : false;

          return {
            partner: 'SPX',
            billCode: spxTn,
            station,
            fullAddress,
            statusName: latest.tracking_name || latest.milestone_name || 'In transit',
            description,
            statusTime: timeStr,
            statusTimestamp: statusTimestamp || undefined,
            isOutdated,
            hoursSinceLastUpdate: hoursSinceLastUpdate || undefined,
            rawUrl: url
          };
        }
      }
    } catch (err) {
      // Silent catch
    }

    return null;
  }

  async fetchJTTracking(billCode: string): Promise<TrackingResult | null> {
    const apis = this.configService.get('carrierPublicApis');
    const baseUrl = apis?.['J&T'] || 'https://jtexpress.vn/vi/tracking?type=track&billcode={code}';
    const url = baseUrl.replace('{code}', encodeURIComponent(billCode));

    try {
      const res = await axios.post(url, '', {
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'x-october-request-handler': 'onSearchPriceList',
          'x-october-request-partials': 'search/pricelist/result-list-search',
          'x-requested-with': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Referer': url
        }
      });

      const data = res.data;
      const htmlSnippet = data?.['search/pricelist/result-list-search'] || (typeof data === 'string' ? data : '');

      if (htmlSnippet) {
        const textOnly = htmlSnippet.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        
        return {
          partner: 'J&T',
          billCode,
          station: this.extractJTStation(textOnly),
          description: textOnly.substring(0, 150),
          statusName: 'Đang chuyển kho/giao',
          statusTime: 'N/A',
          rawUrl: url
        };
      }
    } catch (err) {
      // Silent catch
    }

    return null;
  }

  private extractJTStation(text: string): string {
    if (!text) return 'N/A';
    const match = text.match(/(?:kho|bưu cục|trạm)\s+([A-Za-z0-9_\-\s\u00C0-\u024F\u1E00-\u1EFF]+)/i);
    if (match && match[1]) {
      return match[1].trim().substring(0, 40);
    }
    return 'Bưu cục J&T';
  }
}
