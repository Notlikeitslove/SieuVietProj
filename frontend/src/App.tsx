import React, { useState, useEffect } from 'react';
import {
  fetchOrderAnalysis,
  resetSessionApi,
  getExcelExportUrl,
  sendTelegramNotification,
  fetchSystemConfig,
  saveSystemConfig,
  fetchTelegramChats,
  AnalysisData,
  SystemConfig,
  TelegramChat
} from './services/api';

export const App: React.FC = () => {
  const [activeNav, setActiveNav] = useState<'dashboard' | 'categories' | 'settings'>('dashboard');
  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeCarrier, setActiveCarrier] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [threshold, setThreshold] = useState<string>('24');
  const [lookbackDays, setLookbackDays] = useState<string>('60');
  const [pageSize, setPageSize] = useState<string>('200');
  const [toast, setToast] = useState<string | null>(null);

  // Settings State
  const [configForm, setConfigForm] = useState<Partial<SystemConfig>>({
    stuckThresholdHours: 24,
    customerIds: '28961,18363',
    statusId: '4',
    svUsername: '',
    svPassword: '',
    telegramBotToken: '',
    telegramChatId: '',
    telegramPolling: false,
    cronEnabled: true,
    cronSchedule: '0 8,14 * * *',
    jtPublicApi: '',
    spxPublicApi: '',
  });
  const [savingConfig, setSavingConfig] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);

  // Categories State
  const [customerList, setCustomerList] = useState<Array<{ id: string; label: string }>>([]);
  const [statusList, setStatusList] = useState<Array<{ id: string; label: string }>>([]);
  const [newCid, setNewCid] = useState<string>('');
  const [newClabel, setNewClabel] = useState<string>('');
  const [bulkCustomerInput, setBulkCustomerInput] = useState<string>('');
  const [newSid, setNewSid] = useState<string>('');
  const [newSlabel, setNewSlabel] = useState<string>('');

  // Auto-fetch Telegram Chat IDs Modal / List State
  const [chatList, setChatList] = useState<TelegramChat[]>([]);
  const [loadingChats, setLoadingChats] = useState<boolean>(false);
  const [showChatModal, setShowChatModal] = useState<boolean>(false);

  const showToastMsg = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = async (
    forceRefresh = false,
    customThreshold?: string,
    customLookback?: string,
    customPageSize?: string
  ) => {
    setLoading(true);
    try {
      const res = await fetchOrderAnalysis(
        forceRefresh,
        customThreshold || threshold,
        customLookback || lookbackDays,
        customPageSize || pageSize
      );
      setData(res);
    } catch (err: any) {
      showToastMsg(`❌ Lỗi: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const cfg = await fetchSystemConfig();
      setConfigForm({ ...cfg, svPassword: '' });

      if (cfg.pageSize) {
        setPageSize(String(cfg.pageSize));
      }

      // Parse Customer IDs and Labels
      const cIds = (cfg.customerIds || '28961,18363').split(',').map(s => s.trim()).filter(Boolean);
      let cLabels: Record<string, string> = {};
      try {
        if (cfg.customerLabelsJson) cLabels = JSON.parse(cfg.customerLabelsJson);
      } catch (e) {}

      const parsedCustomers = cIds.map(id => ({
        id,
        label: cLabels[id] || `Khách hàng ${id}`
      }));
      setCustomerList(parsedCustomers);

      // Parse Status IDs and Labels
      const sIds = String(cfg.statusId || '4').split(',').map(s => s.trim()).filter(Boolean);
      let sLabels: Record<string, string> = {
        '4': 'Đang chuyển kho giao',
        '2': 'Đã lấy hàng',
        '5': 'Đang giao hàng',
        '7': 'Chờ xử lý / Hoàn hàng'
      };
      try {
        if (cfg.statusLabelsJson) {
          sLabels = { ...sLabels, ...JSON.parse(cfg.statusLabelsJson) };
        }
      } catch (e) {}

      const parsedStatuses = sIds.map(id => ({
        id,
        label: sLabels[id] || `Trạng thái ${id}`
      }));
      setStatusList(parsedStatuses);
    } catch (err: any) {
      console.error('Lỗi tải cài đặt:', err);
    }
  };

  const handleAddCustomer = () => {
    const id = newCid.trim();
    if (!id) {
      showToastMsg('⚠️ Vui lòng nhập ID Khách Hàng');
      return;
    }
    if (customerList.some(c => c.id === id)) {
      showToastMsg('⚠️ Mã Khách Hàng này đã tồn tại trong danh sách');
      return;
    }
    const label = newClabel.trim() || `Khách hàng ${id}`;
    setCustomerList([...customerList, { id, label }]);
    setNewCid('');
    setNewClabel('');
    showToastMsg(`✅ Đã thêm Mã Khách Hàng ${id} vào danh sách`);
  };

  const handleBulkImportCustomers = () => {
    if (!bulkCustomerInput.trim()) return;
    const ids = bulkCustomerInput.split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) return;
    let addedCount = 0;
    const updated = [...customerList];
    ids.forEach(id => {
      if (!updated.some(c => c.id === id)) {
        updated.push({ id, label: `Khách hàng ${id}` });
        addedCount++;
      }
    });
    setCustomerList(updated);
    setBulkCustomerInput('');
    showToastMsg(`✅ Đã nạp thành công ${addedCount} Mã Khách Hàng mới`);
  };

  const handleDeleteCustomer = (idToDelete: string) => {
    setCustomerList(customerList.filter(c => c.id !== idToDelete));
    showToastMsg(`🗑️ Đã xóa Mã Khách Hàng ${idToDelete}`);
  };

  const handleAddStatus = (idInput?: string, labelInput?: string) => {
    const id = (idInput !== undefined ? idInput : newSid).trim();
    if (!id) {
      showToastMsg('⚠️ Vui lòng nhập ID Trạng Thái');
      return;
    }
    if (statusList.some(s => s.id === id)) {
      showToastMsg('⚠️ Mã Trạng Thái này đã có trong danh sách');
      return;
    }
    const defaultName = id === '4' ? 'Đang chuyển kho giao' : id === '2' ? 'Đã lấy hàng' : id === '5' ? 'Đang giao hàng' : `Trạng thái ${id}`;
    const label = (labelInput !== undefined ? labelInput : newSlabel).trim() || defaultName;
    setStatusList([...statusList, { id, label }]);
    if (idInput === undefined) {
      setNewSid('');
      setNewSlabel('');
    }
    showToastMsg(`✅ Đã thêm Trạng Thái ${id} (${label})`);
  };

  const handleDeleteStatus = (idToDelete: string) => {
    if (statusList.length <= 1) {
      showToastMsg('⚠️ Cần giữ lại ít nhất 1 Trạng Thái để lọc đơn');
      return;
    }
    setStatusList(statusList.filter(s => s.id !== idToDelete));
    showToastMsg(`🗑️ Đã xóa Trạng Thái ${idToDelete}`);
  };

  const handleSaveCategories = async () => {
    if (customerList.length === 0) {
      showToastMsg('⚠️ Danh sách ID Khách Hàng không được trống');
      return;
    }
    if (statusList.length === 0) {
      showToastMsg('⚠️ Danh sách ID Trạng Thái không được trống');
      return;
    }

    setSavingConfig(true);
    try {
      const cIdsStr = customerList.map(c => c.id).join(',');
      const cLabelsMap: Record<string, string> = {};
      customerList.forEach(c => { cLabelsMap[c.id] = c.label; });

      const sIdsStr = statusList.map(s => s.id).join(',');
      const sLabelsMap: Record<string, string> = {};
      statusList.forEach(s => { sLabelsMap[s.id] = s.label; });

      await saveSystemConfig({
        customerIds: cIdsStr,
        customerLabelsJson: JSON.stringify(cLabelsMap),
        statusId: sIdsStr,
        statusLabelsJson: JSON.stringify(sLabelsMap)
      });

      setConfigForm(prev => ({
        ...prev,
        customerIds: cIdsStr,
        customerLabelsJson: JSON.stringify(cLabelsMap),
        statusId: sIdsStr,
        statusLabelsJson: JSON.stringify(sLabelsMap)
      }));

      showToastMsg('🎉 Đã lưu & áp dụng thành công danh mục ID Khách Hàng & ID Trạng Thái!');
    } catch (err: any) {
      showToastMsg(`❌ Lỗi lưu danh mục: ${err.message}`);
    } finally {
      setSavingConfig(false);
    }
  };

  useEffect(() => {
    loadData();
    loadSettings();
  }, []);

  const handleRefresh = () => loadData(true, threshold, lookbackDays, pageSize);

  const handleResetSession = async () => {
    setData(null); // Clear old UI data immediately so user sees visual reset
    setLoading(true);
    showToastMsg('🧹 Đang xóa bộ nhớ tạm & quét phiên dữ liệu mới từ SV Express...');
    try {
      const res = await resetSessionApi(threshold, lookbackDays, pageSize);
      setData(res);
      showToastMsg(`✅ Đã reset phiên làm việc thành công! Cập nhật lúc ${new Date(res.timestamp).toLocaleTimeString()}`);
    } catch (err: any) {
      showToastMsg(`❌ Lỗi reset phiên: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleExportExcel = () => {
    showToastMsg('📊 Đang tạo file Excel...');
    window.location.href = getExcelExportUrl();
  };

  const handleSendTelegram = async () => {
    showToastMsg('✈️ Đang gửi thông báo tới Telegram...');
    try {
      const success = await sendTelegramNotification();
      if (success) showToastMsg('✅ Đã gửi báo cáo qua Telegram!');
      else showToastMsg('❌ Không thể gửi Telegram');
    } catch (err: any) {
      showToastMsg(`❌ Lỗi: ${err.message}`);
    }
  };

  const handleThresholdChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setThreshold(val);
    loadData(true, val, lookbackDays, pageSize);
  };

  const handleLookbackChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setLookbackDays(val);
    loadData(true, threshold, val, pageSize);
  };

  const handlePageSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setPageSize(val);
    loadData(true, threshold, lookbackDays, val);
  };

  const handleSaveSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSavingConfig(true);
    try {
      const res = await saveSystemConfig(configForm);
      if (res.success) {
        showToastMsg('✅ Đã lưu cài đặt mới và ghi nhận vào file .env!');
        loadData(true);
      } else {
        showToastMsg(`❌ ${res.message}`);
      }
    } catch (err: any) {
      showToastMsg(`❌ Lỗi khi lưu cài đặt: ${err.message}`);
    } finally {
      setSavingConfig(false);
    }
  };

  // Auto-Select Cron Schedule and instant submit to BE
  const handleCronScheduleSelect = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newCron = e.target.value;
    const updatedForm = { ...configForm, cronSchedule: newCron };
    setConfigForm(updatedForm);

    showToastMsg('⏳ Đang cập nhật Lịch Cron Schedule mới...');
    try {
      const res = await saveSystemConfig(updatedForm);
      if (res.success) {
        showToastMsg(`✅ Đã cập nhật Lịch Cron: "${newCron}" và lưu .env!`);
      }
    } catch (err: any) {
      showToastMsg(`❌ Lỗi cập nhật Cron: ${err.message}`);
    }
  };

  // Auto-Fetch Chat IDs from Telegram
  const handleAutoFetchChatIds = async () => {
    setLoadingChats(true);
    try {
      const chats = await fetchTelegramChats();
      setChatList(chats);
      setShowChatModal(true);
      if (chats.length === 0) {
        showToastMsg('ℹ️ Chưa thấy tin nhắn mới. Hãy gửi tin nhắn /start trong nhóm Telegram trước!');
      } else {
        showToastMsg(`✅ Tìm thấy ${chats.length} cuộc hội thoại/nhóm Telegram!`);
      }
    } catch (err: any) {
      showToastMsg(`❌ ${err.message}`);
    } finally {
      setLoadingChats(false);
    }
  };

  const selectChatId = (chatId: string, title: string) => {
    setConfigForm({ ...configForm, telegramChatId: chatId });
    setShowChatModal(false);
    showToastMsg(`✅ Đã chọn Chat ID: ${chatId} (${title})`);
  };

  const getPartnerStats = (keys: string[]) => {
    if (!data?.partnerSummary) return { count: 0, maxHours: 0 };
    let count = 0;
    let maxHours = 0;
    Object.keys(data.partnerSummary).forEach(pName => {
      if (keys.some(k => pName.toUpperCase().includes(k))) {
        count += data.partnerSummary[pName].count;
        maxHours = Math.max(maxHours, data.partnerSummary[pName].maxHoursStuck);
      }
    });
    return { count, maxHours };
  };

  const getOtherPartnerStats = (excludeKeys: string[]) => {
    if (!data?.partnerSummary) return { count: 0, maxHours: 0 };
    let count = 0;
    let maxHours = 0;
    Object.keys(data.partnerSummary).forEach(pName => {
      if (!excludeKeys.some(k => pName.toUpperCase().includes(k))) {
        count += data.partnerSummary[pName].count;
        maxHours = Math.max(maxHours, data.partnerSummary[pName].maxHoursStuck);
      }
    });
    return { count, maxHours };
  };

  const copyToClipboard = (text: string, label: string) => {
    if (!text || text === 'N/A') return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToastMsg(`📋 Đã sao chép ${label}: ${text}`);
      }).catch(() => {
        fallbackCopyText(text, label);
      });
    } else {
      fallbackCopyText(text, label);
    }
  };

  const fallbackCopyText = (text: string, label: string) => {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      showToastMsg(`📋 Đã sao chép ${label}: ${text}`);
    } catch (e) {
      showToastMsg(`❌ Không thể sao chép`);
    }
    document.body.removeChild(textArea);
  };

  const getTrackingUrl = (partnerName: string, billCode: string, receiverPhone?: string): string => {
    if (!billCode || billCode === 'N/A') return '';
    const pUpper = (partnerName || '').toUpperCase();
    if (pUpper.includes('SPX') || pUpper.includes('SHOPEE')) {
      return `https://spx.vn/track?${encodeURIComponent(billCode)}`;
    }
    if (pUpper.includes('J&T') || pUpper.includes('JT') || pUpper.includes('JAT')) {
      const cleanPhone = (receiverPhone || '').replace(/\D/g, '');
      const last4 = cleanPhone.length >= 4 ? cleanPhone.slice(-4) : cleanPhone;
      const phoneParam = last4 ? `&cellphone=${encodeURIComponent(last4)}` : '';
      return `https://jtexpress.vn/vi/tracking?type=track&billcode=${encodeURIComponent(billCode)}${phoneParam}`;
    }
    return '';
  };

  const jtStats = getPartnerStats(['J&T', 'JT', 'JAT']);
  const spxStats = getPartnerStats(['SPX', 'SHOPEE']);
  const otherStats = getOtherPartnerStats(['J&T', 'JT', 'JAT', 'SPX', 'SHOPEE']);

  const filteredOrders = (data?.stuckOrders || []).filter(o => {
    if (activeCarrier !== 'ALL' && o.partnerName !== activeCarrier) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      return (
        o.svCode.toLowerCase().includes(q) ||
        o.partnerCode.toLowerCase().includes(q) ||
        o.receiverName.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="app-container">
      {/* Header Navbar */}
      <header className="navbar">
        <div className="brand">
          <div className="brand-icon">🚀</div>
          <div className="brand-text">
            <h1>AUTO CHECK GHSV</h1>
            <span className="subtitle">NestJS Backend + ReactJS Frontend Dashboard</span>
          </div>
        </div>

        {/* Navigation Mode Tabs */}
        <div className="nav-mode-tabs">
          <button
            className={`nav-tab-btn ${activeNav === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveNav('dashboard')}
          >
            📊 Bảng Thống Kê
          </button>
          <button
            className={`nav-tab-btn ${activeNav === 'categories' ? 'active' : ''}`}
            onClick={() => setActiveNav('categories')}
          >
            🗂️ Quản Lý Danh Mục
          </button>
          <button
            className={`nav-tab-btn ${activeNav === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveNav('settings')}
          >
            ⚙️ Cài Đặt Hệ Thống
          </button>
        </div>

        <div className="nav-actions">
          <button onClick={handleResetSession} className="btn btn-warning" title="Xóa bộ nhớ tạm và làm mới phiên quét mới nhất">
            <span>🧹</span> Reset Phiên Mới
          </button>
          <button onClick={handleRefresh} className="btn btn-primary">
            <span>🔄</span> Quét Ngay
          </button>
          <button onClick={handleExportExcel} className="btn btn-success">
            <span>📥</span> Xuất Excel
          </button>
          <button onClick={handleSendTelegram} className="btn btn-telegram">
            <span>✈️</span> Telegram
          </button>
        </div>
      </header>

      {/* VIEW 1: DASHBOARD */}
      {activeNav === 'dashboard' && (
        <>
          {/* Stats Cards */}
          <section className="stats-grid">
            <div className="stat-card total-card">
              <div className="stat-header">
                <span className="stat-title">TỔNG ĐƠN BỊ NGÂM</span>
                <span className="stat-badge danger">🚨 Cần xử lý</span>
              </div>
              <div className="stat-value">{data?.stuckTotal || 0}</div>
              <div className="stat-footer">Đã quét: {data?.scannedTotal || 0} đơn</div>
            </div>

            <div className="stat-card partner-card">
              <div className="stat-header">
                <span className="stat-title">J&T EXPRESS</span>
                <span className="partner-logo">J&T</span>
              </div>
              <div className="stat-value">{jtStats.count}</div>
              <div className="stat-footer">Ngâm max: {jtStats.maxHours}h</div>
            </div>

            <div className="stat-card partner-card">
              <div className="stat-header">
                <span className="stat-title">SPX EXPRESS</span>
                <span className="partner-logo">SPX</span>
              </div>
              <div className="stat-value">{spxStats.count}</div>
              <div className="stat-footer">Ngâm max: {spxStats.maxHours}h</div>
            </div>

            <div className="stat-card partner-card">
              <div className="stat-header">
                <span className="stat-title">LEX / CÁC NVC KHÁC</span>
                <span className="partner-logo">OTHER</span>
              </div>
              <div className="stat-value">{otherStats.count}</div>
              <div className="stat-footer">Ngâm max: {otherStats.maxHours}h</div>
            </div>
          </section>

          {/* Toolbar */}
          <section className="toolbar-section">
            <div className="filter-tabs">
              <button
                className={`tab-btn ${activeCarrier === 'ALL' ? 'active' : ''}`}
                onClick={() => setActiveCarrier('ALL')}
              >
                Tất cả NVC ({data?.stuckTotal || 0})
              </button>
              {data?.partnerSummary &&
                Object.keys(data.partnerSummary).map(p => (
                  <button
                    key={p}
                    className={`tab-btn ${activeCarrier === p ? 'active' : ''}`}
                    onClick={() => setActiveCarrier(p)}
                  >
                    {p} ({data.partnerSummary[p].count})
                  </button>
                ))}
            </div>

            <div className="search-box">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                placeholder="Tìm theo Mã GHSV, Mã Vận Đơn, Tên người nhận..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="threshold-selector">
              <label htmlFor="select-pagesize">Số đơn/trang:</label>
              <select id="select-pagesize" value={pageSize} onChange={handlePageSizeChange}>
                <option value="50">50 đơn/trang</option>
                <option value="100">100 đơn/trang</option>
                <option value="200">200 đơn/trang (Mặc định)</option>
                <option value="500">500 đơn/trang</option>
                <option value="1000">1000 đơn/trang</option>
              </select>
            </div>

            <div className="threshold-selector">
              <label htmlFor="select-lookback">Thời gian quét:</label>
              <select id="select-lookback" value={lookbackDays} onChange={handleLookbackChange}>
                <option value="7">1 Tuần (7 ngày)</option>
                <option value="14">2 Tuần (14 ngày)</option>
                <option value="21">3 Tuần (21 ngày)</option>
                <option value="30">1 Tháng (30 ngày)</option>
                <option value="60">2 Tháng (60 ngày - Mặc định)</option>
                <option value="90">3 Tháng (90 ngày)</option>
                <option value="120">4 Tháng (120 ngày)</option>
              </select>
            </div>

            <div className="threshold-selector">
              <label htmlFor="select-threshold">Ngưỡng ngâm:</label>
              <select id="select-threshold" value={threshold} onChange={handleThresholdChange}>
                <option value="12">&gt;= 12 Giờ</option>
                <option value="18">&gt;= 18 Giờ</option>
                <option value="24">&gt;= 24 Giờ</option>
                <option value="36">&gt;= 36 Giờ</option>
                <option value="48">&gt;= 48 Giờ</option>
              </select>
            </div>
          </section>

          {/* Orders Table */}
          <section className="table-container">
            {loading && (
              <div className="loading-overlay">
                <div className="spinner"></div>
                <p>Đang quét dữ liệu từ API NestJS Backend...</p>
              </div>
            )}

            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '50px' }}>STT</th>
                  <th>NVC</th>
                  <th>Mã GHSV</th>
                  <th>Mã Vận Đơn</th>
                  <th style={{ width: '110px' }}>Giờ Bị Ngâm</th>
                  <th>Bưu Cục / Trạm Giữ (Care Public)</th>
                  <th>Khách Gửi</th>
                  <th>Người Nhận & SĐT</th>
                  <th>Trạng Thái GHSV</th>
                  <th>Ghi Chú Cuối</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="empty-state">
                      <span>📭</span> Không tìm thấy đơn hàng bị ngâm phù hợp.
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((o, idx) => (
                    <tr key={o.svCode + idx}>
                      <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{idx + 1}</td>
                      <td><strong style={{ color: '#f8fafc' }}>{o.partnerName}</strong></td>
                      <td className="code-cell">
                        <span
                          className="copyable-cell"
                          onClick={() => copyToClipboard(o.svCode, 'Mã GHSV')}
                          title="Click để sao chép Mã GHSV"
                        >
                          {o.svCode} <span className="copy-icon">📋</span>
                        </span>
                      </td>
                      <td className="code-cell">
                        <span
                          className="copyable-cell"
                          onClick={() => copyToClipboard(o.partnerCode, 'Mã Vận Đơn NVC')}
                          title="Click để sao chép Mã Vận Đơn NVC"
                          style={{ color: 'var(--accent-purple)' }}
                        >
                          {o.partnerCode} <span className="copy-icon">📋</span>
                        </span>
                        {getTrackingUrl(o.partnerName, o.partnerCode, o.receiverPhone) && (
                          <a
                            href={getTrackingUrl(o.partnerName, o.partnerCode, o.receiverPhone)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="tracking-link-icon"
                            title={`Mở trang tra cứu web của ${o.partnerName}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--accent-blue)', textDecoration: 'none' }}
                          >
                            🔗
                          </a>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`badge-stuck ${o.hoursStuck >= 48 ? 'danger' : 'warning'}`}>
                          {o.hoursStuck}h
                        </span>
                      </td>
                      <td>
                        {o.publicTracking ? (
                          <div>
                            <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>
                              {o.publicTracking.station || o.publicTracking.description || 'N/A'}
                            </span>
                            {o.publicTracking.statusTime && o.publicTracking.statusTime !== 'N/A' && (
                              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                {o.publicTracking.statusTime}
                              </div>
                            )}
                            {o.publicTracking.isOutdated && (
                              <div className="badge-warning-outdated">
                                ⚠️ Trạm chưa đổi &gt; 24h ({o.publicTracking.hoursSinceLastUpdate || o.hoursStuck}h)
                              </div>
                            )}
                            {getTrackingUrl(o.partnerName, o.partnerCode, o.receiverPhone) && (
                              <div>
                                <a
                                  href={getTrackingUrl(o.partnerName, o.partnerCode, o.receiverPhone)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="btn-web-tracking"
                                  title={`Xem giao diện tra cứu trực tiếp trên ${o.partnerName}`}
                                >
                                  <span>🌐</span> Tra cứu {o.partnerName} 🔗
                                </a>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                            <span style={{ color: '#64748b', fontSize: '11px' }}>Chưa kiểm tra</span>
                            {o.hoursStuck >= 24 && (
                              <div className="badge-warning-outdated">
                                ⚠️ GHSV chưa đổi &gt; 24h ({o.hoursStuck}h)
                              </div>
                            )}
                            {getTrackingUrl(o.partnerName, o.partnerCode, o.receiverPhone) && (
                              <div>
                                <a
                                  href={getTrackingUrl(o.partnerName, o.partnerCode, o.receiverPhone)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="btn-web-tracking"
                                  title={`Xem giao diện tra cứu trực tiếp trên ${o.partnerName}`}
                                >
                                  <span>🌐</span> Tra cứu {o.partnerName} 🔗
                                </a>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td>{o.customerName}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{o.receiverName}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{o.receiverPhone}</div>
                      </td>
                      <td><span style={{ color: 'var(--warning-color)', fontWeight: 500 }}>{o.statusName}</span></td>
                      <td>
                        {o.lastNote ? (
                          <span style={{ fontSize: '11px', color: '#cbd5e1' }}>{o.lastNote}</span>
                        ) : (
                          <span style={{ color: '#64748b' }}>(Không có)</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        </>
      )}

      {/* VIEW 2: CATEGORIES MANAGEMENT TAB */}
      {activeNav === 'categories' && (
        <section className="categories-container">
          <div className="categories-header-bar">
            <div>
              <h2>🗂️ Quản Lý Danh Mục Lọc Đơn Hàng</h2>
              <p className="categories-subtitle">
                Tự do Thêm / Sửa / Xóa danh sách <b>ID Khách Hàng</b> và <b>ID Trạng Thái</b> cần quét đơn từ SV Express API.
              </p>
            </div>
            <button
              onClick={handleSaveCategories}
              disabled={savingConfig}
              className="btn btn-primary btn-save-categories"
            >
              <span>{savingConfig ? '⏳' : '💾'}</span> {savingConfig ? 'Đang lưu...' : 'Lưu & Áp Dụng Danh Mục'}
            </button>
          </div>

          <div className="categories-grid">
            {/* COLUMN 1: CUSTOMER IDS MANAGEMENT */}
            <div className="category-card">
              <div className="card-header">
                <h3>👥 1. Danh Mục ID Khách Hàng (Customer IDs)</h3>
                <span className="card-desc">Hiện tại có <b>{customerList.length}</b> khách hàng đang được kích hoạt</span>
              </div>

              {/* Form Add New Customer */}
              <div className="add-item-form">
                <div className="form-row">
                  <div className="form-group flex-1">
                    <label>Mã ID Khách Hàng (*):</label>
                    <input
                      type="text"
                      value={newCid}
                      onChange={e => setNewCid(e.target.value)}
                      placeholder="VD: 28961"
                      onKeyDown={e => e.key === 'Enter' && handleAddCustomer()}
                    />
                  </div>
                  <div className="form-group flex-2">
                    <label>Tên / Ghi Chú Shop (Tùy chọn):</label>
                    <input
                      type="text"
                      value={newClabel}
                      onChange={e => setNewClabel(e.target.value)}
                      placeholder="VD: Shop Miền Bắc / Kho Tổng"
                      onKeyDown={e => e.key === 'Enter' && handleAddCustomer()}
                    />
                  </div>
                  <button type="button" onClick={handleAddCustomer} className="btn btn-success btn-add-inline">
                    ➕ Thêm
                  </button>
                </div>
              </div>

              {/* Bulk Input Box */}
              <div className="bulk-import-box">
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-blue)' }}>
                  📥 Nhập nhanh nhiều ID (Phân cách bằng dấu phẩy):
                </label>
                <div className="bulk-import-row">
                  <input
                    type="text"
                    value={bulkCustomerInput}
                    onChange={e => setBulkCustomerInput(e.target.value)}
                    placeholder="VD: 28961, 18363, 30500"
                  />
                  <button type="button" onClick={handleBulkImportCustomers} className="btn btn-secondary">
                    Nạp Nhanh
                  </button>
                </div>
              </div>

              {/* Customer Items Table */}
              <div className="category-items-list">
                <h4>📋 Danh sách ID Khách Hàng hiện tại ({customerList.length})</h4>
                <table className="category-table">
                  <thead>
                    <tr>
                      <th style={{ width: '50px', textAlign: 'center' }}>STT</th>
                      <th style={{ width: '120px' }}>Mã ID</th>
                      <th>Tên Shop / Ghi Chú Khách Hàng</th>
                      <th style={{ width: '80px', textAlign: 'center' }}>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerList.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                          Chưa có ID khách hàng nào. Vui lòng thêm ít nhất 1 ID.
                        </td>
                      </tr>
                    ) : (
                      customerList.map((item, idx) => (
                        <tr key={item.id}>
                          <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                          <td>
                            <span className="badge-id-code">{item.id}</span>
                          </td>
                          <td>
                            <input
                              type="text"
                              value={item.label}
                              className="input-inline-edit"
                              onChange={e => {
                                const val = e.target.value;
                                setCustomerList(customerList.map(c => c.id === item.id ? { ...c, label: val } : c));
                              }}
                              placeholder="Nhập tên shop / ghi chú..."
                            />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleDeleteCustomer(item.id)}
                              className="btn-action-delete"
                              title="Xóa ID Khách Hàng này"
                            >
                              🗑️ Xóa
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* COLUMN 2: STATUS IDS MANAGEMENT */}
            <div className="category-card">
              <div className="card-header">
                <h3>🏷️ 2. Danh Mục ID Trạng Thái Cần Lọc (Status IDs)</h3>
                <span className="card-desc">Hiện tại có <b>{statusList.length}</b> trạng thái đơn đang được lọc</span>
              </div>

              {/* Form Add New Status */}
              <div className="add-item-form">
                <div className="form-row">
                  <div className="form-group flex-1">
                    <label>Mã ID Trạng Thái (*):</label>
                    <input
                      type="text"
                      value={newSid}
                      onChange={e => setNewSid(e.target.value)}
                      placeholder="VD: 4"
                      onKeyDown={e => e.key === 'Enter' && handleAddStatus()}
                    />
                  </div>
                  <div className="form-group flex-2">
                    <label>Tên Trạng Thái (Mô tả):</label>
                    <input
                      type="text"
                      value={newSlabel}
                      onChange={e => setNewSlabel(e.target.value)}
                      placeholder="VD: Đang chuyển kho giao"
                      onKeyDown={e => e.key === 'Enter' && handleAddStatus()}
                    />
                  </div>
                  <button type="button" onClick={() => handleAddStatus()} className="btn btn-success btn-add-inline">
                    ➕ Thêm
                  </button>
                </div>
              </div>

              {/* Presets Quick Add */}
              <div className="status-presets-box">
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                  💡 Gợi ý thêm nhanh Trạng Thái chuẩn GHSV:
                </label>
                <div className="preset-buttons">
                  <button type="button" className="btn-preset" onClick={() => handleAddStatus('4', 'Đang chuyển kho giao')}>
                    + ID 4 (Đang chuyển kho giao)
                  </button>
                  <button type="button" className="btn-preset" onClick={() => handleAddStatus('2', 'Đã lấy hàng')}>
                    + ID 2 (Đã lấy hàng)
                  </button>
                  <button type="button" className="btn-preset" onClick={() => handleAddStatus('5', 'Đang giao hàng')}>
                    + ID 5 (Đang giao hàng)
                  </button>
                  <button type="button" className="btn-preset" onClick={() => handleAddStatus('7', 'Chờ xử lý / Hoàn hàng')}>
                    + ID 7 (Chờ xử lý / Hoàn hàng)
                  </button>
                </div>
              </div>

              {/* Status Items Table */}
              <div className="category-items-list">
                <h4>📋 Danh sách ID Trạng Thái lọc hiện tại ({statusList.length})</h4>
                <table className="category-table">
                  <thead>
                    <tr>
                      <th style={{ width: '50px', textAlign: 'center' }}>STT</th>
                      <th style={{ width: '120px' }}>Mã ID</th>
                      <th>Tên Trạng Thái</th>
                      <th style={{ width: '80px', textAlign: 'center' }}>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusList.map((item, idx) => (
                      <tr key={item.id}>
                        <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                        <td>
                          <span className="badge-id-code status">{item.id}</span>
                        </td>
                        <td>
                          <input
                            type="text"
                            value={item.label}
                            className="input-inline-edit"
                            onChange={e => {
                              const val = e.target.value;
                              setStatusList(statusList.map(s => s.id === item.id ? { ...s, label: val } : s));
                            }}
                            placeholder="Nhập tên trạng thái..."
                          />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleDeleteStatus(item.id)}
                            className="btn-action-delete"
                            title="Xóa Trạng Thái này"
                          >
                            🗑️ Xóa
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div style={{ marginTop: '20px', textAlign: 'right' }}>
            <button
              onClick={handleSaveCategories}
              disabled={savingConfig}
              className="btn btn-primary btn-save-categories"
              style={{ padding: '12px 28px', fontSize: '15px' }}
            >
              <span>{savingConfig ? '⏳' : '💾'}</span> {savingConfig ? 'Đang lưu...' : 'Lưu & Áp Dụng Cả 2 Danh Mục'}
            </button>
          </div>
        </section>
      )}

      {/* VIEW 3: SETTINGS TAB */}
      {activeNav === 'settings' && (
        <section className="settings-container">
          <form onSubmit={handleSaveSettings} className="settings-form">
            <div className="settings-grid">
              {/* Card 1: Điều kiện lọc đơn */}
              <div className="settings-card">
                <div className="card-header">
                  <h3>🎯 Điều Kiện Lọc Đơn Giục</h3>
                  <span className="card-desc">Cấu hình các tham số lọc đơn bị ngâm</span>
                </div>
                <div className="form-group">
                  <label>Ngưỡng thời gian ngâm (Số Giờ):</label>
                  <input
                    type="number"
                    value={configForm.stuckThresholdHours || 24}
                    onChange={e => setConfigForm({ ...configForm, stuckThresholdHours: parseFloat(e.target.value) })}
                    placeholder="24"
                    required
                  />
                  <span className="hint">Chỉ đơn hàng bị ngâm &gt;= số giờ này mới đưa vào danh sách giục.</span>
                </div>
                <div className="form-group">
                  <label>Kích Thước Trang Mặc Định (pageSize):</label>
                  <input
                    type="number"
                    value={configForm.pageSize || 200}
                    onChange={e => setConfigForm({ ...configForm, pageSize: parseInt(e.target.value, 10) || 200 })}
                    placeholder="200"
                    min="10"
                    max="2000"
                  />
                  <span className="hint">Mặc định 200 đơn/trang. Bạn có thể tự điều chỉnh thành 50, 100, 200, 500, 1000...</span>
                </div>
                <div className="form-group">
                  <label>ID Khách Hàng (Phân cách bằng dấu phẩy):</label>
                  <input
                    type="text"
                    value={configForm.customerIds || ''}
                    onChange={e => setConfigForm({ ...configForm, customerIds: e.target.value })}
                    placeholder="28961,18363"
                  />
                  <span className="hint">Mã ID khách hàng cần lọc (ví dụ: 28961,18363).</span>
                </div>
                <div className="form-group">
                  <label>ID Trạng Thái Cần Lọc:</label>
                  <input
                    type="number"
                    value={configForm.statusId || 4}
                    onChange={e => setConfigForm({ ...configForm, statusId: parseInt(e.target.value, 10) })}
                    placeholder="4"
                  />
                  <span className="hint">Trạng thái 4 = "Đang chuyển kho giao".</span>
                </div>
              </div>

              {/* Card 2: Tài khoản GHSV (SECURITY PROTECTED) */}
              <div className="settings-card">
                <div className="card-header">
                  <h3>🔑 Tài Khoản GHSV (SV Express)</h3>
                  <span className="card-desc">Chỉ lưu mật khẩu an toàn trong file .env (Không lộ ra FE)</span>
                </div>
                <div className="form-group">
                  <label>Số Điện Thoại / Email Đăng Nhập:</label>
                  <input
                    type="text"
                    value={configForm.svUsername || ''}
                    onChange={e => setConfigForm({ ...configForm, svUsername: e.target.value })}
                    placeholder="0972610009"
                  />
                </div>
                <div className="form-group">
                  <label>Mật Khẩu Mới (Bỏ trống nếu không muốn đổi):</label>
                  <div className="password-input-group">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={configForm.svPassword || ''}
                      onChange={e => setConfigForm({ ...configForm, svPassword: e.target.value })}
                      placeholder="•••••••• (Mật khẩu đã bảo mật trong .env)"
                    />
                    <button
                      type="button"
                      className="btn-toggle-pwd"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? '🙈' : '👁️'}
                    </button>
                  </div>
                  <span className="hint">Mật khẩu được lưu bảo mật trong file .env và không bao giờ hiển thị trên giao diện FE.</span>
                </div>
              </div>

              {/* Card 3: Telegram Bot & Auto Fetch Chat ID */}
              <div className="settings-card">
                <div className="card-header">
                  <h3>✈️ Cấu Hình Telegram Bot</h3>
                  <span className="card-desc">Cài đặt gửi thông báo &amp; nhận bộ lệnh /check, /excel</span>
                </div>
                <div className="form-group">
                  <label>Telegram Bot Token (@BotFather):</label>
                  <input
                    type="text"
                    value={configForm.telegramBotToken || ''}
                    onChange={e => setConfigForm({ ...configForm, telegramBotToken: e.target.value })}
                    placeholder="123456789:ABCdefGhIJKlmNo..."
                  />
                </div>
                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label>Telegram Chat ID Nhận Báo Cáo:</label>
                    <button
                      type="button"
                      onClick={handleAutoFetchChatIds}
                      disabled={loadingChats}
                      className="btn-text-action"
                    >
                      {loadingChats ? '⌛ Đang quét...' : '🔍 Auto Lấy Chat ID Nhóm'}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={configForm.telegramChatId || ''}
                    onChange={e => setConfigForm({ ...configForm, telegramChatId: e.target.value })}
                    placeholder="-100123456789"
                  />
                  <span className="hint">Bấm "Auto Lấy Chat ID Nhóm" để hệ thống tự dò Chat ID các nhóm Telegram vừa nhắn tin với Bot.</span>
                </div>
                <div className="form-checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(configForm.telegramPolling)}
                      onChange={e => setConfigForm({ ...configForm, telegramPolling: e.target.checked })}
                    />
                    Bật Polling tương tác nhận lệnh trực tiếp qua Telegram (/check, /excel, /status)
                  </label>
                </div>
              </div>

              {/* Card 4: Đặt lịch Cronjob (SELECT MENU WITH AUTO-SUBMIT) */}
              <div className="settings-card">
                <div className="card-header">
                  <h3>⏰ Lịch Quét Tự Động (Cronjob Schedule)</h3>
                  <span className="card-desc">Chọn khung giờ tự động quét và gửi BE ngay lập tức</span>
                </div>
                <div className="form-checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(configForm.cronEnabled)}
                      onChange={e => setConfigForm({ ...configForm, cronEnabled: e.target.checked })}
                    />
                    Cho phép chạy tự động theo lịch (Schedule)
                  </label>
                </div>
                <div className="form-group">
                  <label>Chọn Lịch Tự Động Quét (Tự động gửi BE):</label>
                  <select
                    className="select-cron"
                    value={configForm.cronSchedule || '0 8,14 * * *'}
                    onChange={handleCronScheduleSelect}
                  >
                    <option value="0 8,14 * * *">8:00 AM &amp; 2:00 PM hàng ngày (Mặc định)</option>
                    <option value="0 8,12,16 * * *">8:00 AM, 12:00 PM &amp; 4:00 PM hàng ngày</option>
                    <option value="0 8 * * *">8:00 AM sáng hàng ngày</option>
                    <option value="0 14 * * *">2:00 PM chiều hàng ngày</option>
                    <option value="0 9,15 * * *">9:00 AM &amp; 3:00 PM hàng ngày</option>
                    <option value="0 */4 * * *">Mỗi 4 tiếng 1 lần</option>
                    <option value="0 */2 * * *">Mỗi 2 tiếng 1 lần</option>
                    <option value="0 * * * *">Mỗi 1 tiếng 1 lần</option>
                  </select>
                  <span className="hint">Biểu thức Cron hiện tại: <code>{configForm.cronSchedule || '0 8,14 * * *'}</code> (Tự động ghi vào .env sau khi chọn).</span>
                </div>
              </div>

              {/* Card 5: Public Tracking APIs */}
              <div className="settings-card full-width">
                <div className="card-header">
                  <h3>🚚 API Tra Cứu Public NVC (Care Hành Trình Chuyên Sâu)</h3>
                  <span className="card-desc">Cấu hình URL endpoint tra cứu vị trí bưu cục</span>
                </div>
                <div className="form-group">
                  <label>API Public J&amp;T Express:</label>
                  <input
                    type="text"
                    value={configForm.jtPublicApi || ''}
                    onChange={e => setConfigForm({ ...configForm, jtPublicApi: e.target.value })}
                    placeholder="https://jtexpress.vn/vi/tracking?type=track&billcode={code}"
                  />
                </div>
                <div className="form-group">
                  <label>API Public SPX Express:</label>
                  <input
                    type="text"
                    value={configForm.spxPublicApi || ''}
                    onChange={e => setConfigForm({ ...configForm, spxPublicApi: e.target.value })}
                    placeholder="https://spx.vn/shipment/order/open/order/get_order_info?spx_tn={code}&language_code=vi"
                  />
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="settings-actions">
              <button type="submit" className="btn btn-success btn-large" disabled={savingConfig}>
                {savingConfig ? '⌛ Đang Lưu Cấu Hình...' : '💾 Lưu Cấu Hình & Ghi Vào .env'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Telegram Chat Selection Modal */}
      {showChatModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>🔍 Danh Sách Nhóm / Chat Telegram Tìm Thấy</h3>
              <button className="btn-close" onClick={() => setShowChatModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {chatList.length === 0 ? (
                <p className="empty-chat-msg">
                  ⚠️ Chưa thấy tin nhắn mới từ Bot. Vui lòng nhắn tin <code>/start</code> trong nhóm Telegram của bạn rồi bấm thử lại!
                </p>
              ) : (
                <ul className="chat-selection-list">
                  {chatList.map(c => (
                    <li key={c.id} className="chat-item" onClick={() => selectChatId(c.id, c.title)}>
                      <div className="chat-info">
                        <span className="chat-title">{c.title}</span>
                        <span className="chat-type">Loại: {c.type}</span>
                      </div>
                      <span className="chat-id-badge">ID: {c.id}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={handleAutoFetchChatIds}>🔄 Quét Trại Mới</button>
              <button className="btn btn-secondary" onClick={() => setShowChatModal(false)}>Đóng</button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="footer">
        <span>Auto Check Order Journey • NestJS + ReactJS Fullstack</span>
        <span>Cập nhật lần cuối: {data?.timestamp ? new Date(data.timestamp).toLocaleString('vi-VN') : 'Chưa quét'}</span>
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
};

export default App;
