export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  svOrderApiUrl: process.env.SV_ORDER_API_URL || 'https://api.svexpress.vn/v1/order',
  svLoginApiUrl: process.env.SV_LOGIN_API_URL || 'https://api.svexpress.vn/v1/auth/login',
  svUsername: process.env.SV_USERNAME || '',
  svPassword: process.env.SV_PASSWORD || '',
  svAuthToken: process.env.SV_AUTH_TOKEN || '',
  stuckThresholdHours: parseFloat(process.env.STUCK_THRESHOLD_HOURS) || 24,
  customerIds: (process.env.CUSTOMER_IDS || '28961,18363').split(',').map(s => s.trim()).filter(Boolean),
  statusId: parseInt(process.env.STATUS_ID, 10) || 4,
  dateFilterType: process.env.DATE_FILTER_TYPE || 'pickup_at',
  warehouseType: parseInt(process.env.WAREHOUSE_TYPE, 10) || 2,
  defaultLookbackDays: parseInt(process.env.DEFAULT_LOOKBACK_DAYS, 10) || 60,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  telegramPolling: process.env.TELEGRAM_POLLING === 'true',
  cronEnabled: process.env.CRON_ENABLED === 'true',
  cronSchedule: process.env.CRON_SCHEDULE || '0 8,14 * * *',
  carrierPublicApis: {
    'J&T': process.env.JT_PUBLIC_TRACKING_API_URL || 'https://jtexpress.vn/vi/tracking?type=track&billcode={code}',
    'SPX': process.env.SPX_PUBLIC_TRACKING_API_URL || 'https://spx.vn/shipment/order/open/order/get_order_info?spx_tn={code}&language_code=vi',
    'LEX': process.env.LEX_PUBLIC_TRACKING_API_URL || ''
  }
});
