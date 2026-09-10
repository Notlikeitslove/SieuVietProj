const config = require('./config');
const app = require('./src/app');
const telegramService = require('./src/services/telegramService');
const { initCronJob } = require('./src/jobs/cronJob');

const PORT = config.port;

// Start Express Server
const server = app.listen(PORT, () => {
  console.log('\n================================================================================');
  console.log(`🚀 AUTO CHECK ĐƠN HÀNG GHSV - SYSTEM STARTED SUCCESSFUL`);
  console.log('================================================================================');
  console.log(`🌐 Web Dashboard   : http://localhost:${PORT}`);
  console.log(`⏱️ Ngưỡng giờ ngâm: ${config.stuckThresholdHours} Giờ`);
  console.log(`👥 ID Khách Hàng   : ${config.customerIds.join(', ')}`);
  console.log(`📌 ID Trạng Thái   : ${config.statusId} (Đang chuyển kho giao)`);
  console.log('--------------------------------------------------------------------------------');

  // Initialize Telegram Bot service
  telegramService.init();

  // Initialize Cron Job automatic scheduler
  initCronJob();
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Đang dừng hệ thống...');
  server.close(() => {
    process.exit(0);
  });
});
