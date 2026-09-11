import axios from 'axios';

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3000';

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
  publicTracking?: {
    partner: string;
    billCode: string;
    station: string;
    fullAddress?: string;
    statusName: string;
    description: string;
    statusTime?: string;
    isOutdated?: boolean;
    hoursSinceLastUpdate?: number;
  } | null;
}

export interface AnalysisData {
  scannedTotal: number;
  stuckTotal: number;
  thresholdHours: number;
  timestamp: string;
  partnerSummary: Record<string, { count: number; maxHoursStuck: number; orders: StuckOrder[] }>;
  stuckOrders: StuckOrder[];
  cancelled?: boolean;
  truncated?: boolean;
}

export interface SystemConfig {
  stuckThresholdHours: number;
  pageSize?: number;
  maxScanPages?: number;
  customerIds: string;
  customerLabelsJson?: string;
  statusId: string | number;
  statusLabelsJson?: string;
  dateFilterType?: string;
  svUsername: string;
  svPassword?: string;
  svPasswordConfigured?: boolean;
  svOrderApiUrl?: string;
  svLoginApiUrl?: string;
  telegramBotToken: string;
  telegramChatId: string;
  telegramPolling: boolean;
  cronEnabled: boolean;
  cronSchedule: string;
  jtPublicApi: string;
  spxPublicApi: string;
}

export interface TelegramChat {
  id: string;
  title: string;
  type: string;
}

export interface Shop {
  svCustomerId: string;
  code?: string;
  name: string;
  phone?: string;
  username?: string;
  queryLabel?: string;
  groupId: number | null;
}

export interface ShopGroup {
  id: number;
  name: string;
  createdAt: string;
  shops: Shop[];
}

export async function fetchOrderAnalysis(forceRefresh = false, threshold?: string, lookbackDays?: string, pageSize?: string): Promise<AnalysisData> {
  let url = `${API_BASE_URL}/api/check?public_tracking=true`;
  if (forceRefresh) url += '&refresh=true';
  if (threshold) url += `&threshold=${threshold}`;
  if (lookbackDays) url += `&lookback=${lookbackDays}`;
  if (pageSize) url += `&pageSize=${pageSize}`;

  const response = await axios.get(url);
  if (response.data?.success) {
    return response.data.data;
  }
  throw new Error(response.data?.message || 'Lỗi kết nối API NestJS Server');
}

export async function cancelScan(): Promise<{ success: boolean; stopped: boolean; message: string }> {
  const response = await axios.post(`${API_BASE_URL}/api/cancel-scan`);
  return response.data;
}

export async function resetSessionApi(threshold?: string, lookbackDays?: string, pageSize?: string): Promise<AnalysisData> {
  let url = `${API_BASE_URL}/api/reset?public_tracking=true`;
  if (threshold) url += `&threshold=${threshold}`;
  if (lookbackDays) url += `&lookback=${lookbackDays}`;
  if (pageSize) url += `&pageSize=${pageSize}`;

  const response = await axios.post(url);
  if (response.data?.success) {
    return response.data.data;
  }
  throw new Error(response.data?.message || 'Lỗi khi reset phiên làm việc');
}

export function getExcelExportUrl(): string {
  return `${API_BASE_URL}/api/export`;
}

export async function sendTelegramNotification(): Promise<boolean> {
  const response = await axios.post(`${API_BASE_URL}/api/telegram-notify`);
  return response.data?.success === true;
}

export async function fetchSystemConfig(): Promise<SystemConfig> {
  const response = await axios.get(`${API_BASE_URL}/api/config`);
  return response.data;
}

export async function saveSystemConfig(configData: Partial<SystemConfig>): Promise<{ success: boolean; message: string }> {
  const response = await axios.post(`${API_BASE_URL}/api/config`, configData);
  return response.data;
}

export async function fetchTelegramChats(): Promise<TelegramChat[]> {
  const response = await axios.get(`${API_BASE_URL}/api/telegram-chats`);
  if (response.data?.success) {
    return response.data.chats || [];
  }
  throw new Error(response.data?.message || 'Không lấy được danh sách chat Telegram.');
}

export async function fetchShopGroups(): Promise<{ groups: ShopGroup[]; ungrouped: Shop[] }> {
  const response = await axios.get(`${API_BASE_URL}/api/shop-groups`);
  return { groups: response.data?.groups || [], ungrouped: response.data?.ungrouped || [] };
}

export async function createShopGroup(name: string): Promise<{ success: boolean; message: string; id?: number }> {
  const response = await axios.post(`${API_BASE_URL}/api/shop-groups`, { name });
  return response.data;
}

export async function renameShopGroup(id: number, name: string): Promise<{ success: boolean; message: string }> {
  const response = await axios.put(`${API_BASE_URL}/api/shop-groups/${id}`, { name });
  return response.data;
}

export async function deleteShopGroup(id: number): Promise<{ success: boolean; message: string }> {
  const response = await axios.delete(`${API_BASE_URL}/api/shop-groups/${id}`);
  return response.data;
}

export async function applyShopGroup(id: number): Promise<{ success: boolean; message: string; customerIds?: string; customerLabelsJson?: string }> {
  const response = await axios.post(`${API_BASE_URL}/api/shop-groups/${id}/apply`);
  return response.data;
}

export async function createShop(shop: Partial<Shop>): Promise<{ success: boolean; message: string }> {
  const response = await axios.post(`${API_BASE_URL}/api/shops`, shop);
  return response.data;
}

export async function updateShop(svCustomerId: string, shop: Partial<Shop>): Promise<{ success: boolean; message: string }> {
  const response = await axios.put(`${API_BASE_URL}/api/shops/${svCustomerId}`, shop);
  return response.data;
}

export async function deleteShop(svCustomerId: string): Promise<{ success: boolean; message: string }> {
  const response = await axios.delete(`${API_BASE_URL}/api/shops/${svCustomerId}`);
  return response.data;
}
