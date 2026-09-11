import React, { useState, useEffect } from 'react';
import {
  fetchOrderAnalysis,
  resetSessionApi,
  getExcelExportUrl,
  sendTelegramNotification,
  fetchSystemConfig,
  saveSystemConfig,
  fetchTelegramChats,
  cancelScan,
  fetchShopGroups,
  createShopGroup,
  renameShopGroup,
  deleteShopGroup,
  applyShopGroup,
  createShop,
  updateShop,
  deleteShop,
  AnalysisData,
  StuckOrder,
  SystemConfig,
  TelegramChat,
  ShopGroup,
  Shop
} from './services/api';

const THRESHOLD_OPTIONS = [
  { value: '12', label: '≥ 12h' },
  { value: '18', label: '≥ 18h' },
  { value: '24', label: '≥ 24h' },
  { value: '36', label: '≥ 36h' },
  { value: '48', label: '≥ 48h' },
];
const MIN_FETCH_THRESHOLD = THRESHOLD_OPTIONS[0].value;

const LOOKBACK_OPTIONS = [
  { value: '7', label: '1 Tuần' },
  { value: '14', label: '2 Tuần' },
  { value: '21', label: '3 Tuần' },
  { value: '30', label: '1 Tháng' },
  { value: '60', label: '2 Tháng' },
  { value: '90', label: '3 Tháng' },
  { value: '120', label: '4 Tháng' },
];

const PAGE_SIZE_OPTIONS = ['50', '100', '200', '500', '1000'];

export const App: React.FC = () => {
  const [activeNav, setActiveNav] = useState<'dashboard' | 'categories' | 'shopGroups' | 'settings'>('dashboard');
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
    maxScanPages: 300,
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

  // Categories State (Status IDs only - Customer IDs are now managed via Shop Groups)
  const [statusList, setStatusList] = useState<Array<{ id: string; label: string }>>([]);
  const [newSid, setNewSid] = useState<string>('');
  const [newSlabel, setNewSlabel] = useState<string>('');

  // Auto-fetch Telegram Chat IDs Modal / List State
  const [chatList, setChatList] = useState<TelegramChat[]>([]);
  const [loadingChats, setLoadingChats] = useState<boolean>(false);
  const [showChatModal, setShowChatModal] = useState<boolean>(false);

  // Shop Groups Management State
  const [shopGroupList, setShopGroupList] = useState<ShopGroup[]>([]);
  const [ungroupedShops, setUngroupedShops] = useState<Shop[]>([]);
  const [loadingShopGroups, setLoadingShopGroups] = useState<boolean>(false);
  const [newGroupName, setNewGroupName] = useState<string>('');
  const [applyingGroupId, setApplyingGroupId] = useState<number | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingGroupName, setEditingGroupName] = useState<string>('');
  const [newShopForms, setNewShopForms] = useState<Record<number, { svCustomerId: string; name: string; phone: string; code: string }>>({});
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<number>>(new Set());
  const [shopSearchQuery, setShopSearchQuery] = useState<string>('');
  const [applyingDashboardFilter, setApplyingDashboardFilter] = useState<boolean>(false);

  const showToastMsg = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = async (
    forceRefresh = false,
    customLookback?: string,
    customPageSize?: string
  ) => {
    setLoading(true);
    try {
      // Always fetch at the lowest threshold option (MIN_FETCH_THRESHOLD) so every
      // higher threshold button can filter this same dataset client-side instantly,
      // with zero extra API calls / re-scans of SV Express.
      const res = await fetchOrderAnalysis(
        forceRefresh,
        MIN_FETCH_THRESHOLD,
        customLookback || lookbackDays,
        customPageSize || pageSize
      );
      setData(res);
      if (res.cancelled) {
        showToastMsg(`🛑 Đã dừng quét theo yêu cầu — xử lý được ${res.scannedTotal} đơn trước khi dừng.`);
      } else if (res.truncated) {
        showToastMsg(`⚠️ Đã đạt giới hạn an toàn số trang — chỉ mới tải được ${res.scannedTotal} đơn (có thể chưa đầy đủ). Thu hẹp bộ lọc hoặc tăng giới hạn trong Cài Đặt.`);
      }
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
    if (statusList.length === 0) {
      showToastMsg('⚠️ Danh sách ID Trạng Thái không được trống');
      return;
    }

    setSavingConfig(true);
    try {
      const sIdsStr = statusList.map(s => s.id).join(',');
      const sLabelsMap: Record<string, string> = {};
      statusList.forEach(s => { sLabelsMap[s.id] = s.label; });

      await saveSystemConfig({
        statusId: sIdsStr,
        statusLabelsJson: JSON.stringify(sLabelsMap)
      });

      setConfigForm(prev => ({
        ...prev,
        statusId: sIdsStr,
        statusLabelsJson: JSON.stringify(sLabelsMap)
      }));

      showToastMsg('🎉 Đã lưu & áp dụng thành công danh mục ID Trạng Thái!');
    } catch (err: any) {
      showToastMsg(`❌ Lỗi lưu danh mục: ${err.message}`);
    } finally {
      setSavingConfig(false);
    }
  };

  const loadShopGroups = async () => {
    setLoadingShopGroups(true);
    try {
      const { groups, ungrouped } = await fetchShopGroups();
      setShopGroupList(groups);
      setUngroupedShops(ungrouped);
    } catch (err: any) {
      showToastMsg(`❌ Lỗi tải danh sách nhóm shop: ${err.message}`);
    } finally {
      setLoadingShopGroups(false);
    }
  };

  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name) {
      showToastMsg('⚠️ Vui lòng nhập tên nhóm');
      return;
    }
    try {
      const res = await createShopGroup(name);
      if (res.success) {
        setNewGroupName('');
        showToastMsg(`✅ ${res.message}`);
        loadShopGroups();
      } else {
        showToastMsg(`❌ ${res.message}`);
      }
    } catch (err: any) {
      showToastMsg(`❌ Lỗi tạo nhóm: ${err.message}`);
    }
  };

  const handleStartRenameGroup = (group: ShopGroup) => {
    setEditingGroupId(group.id);
    setEditingGroupName(group.name);
  };

  const handleSaveRenameGroup = async (groupId: number) => {
    const name = editingGroupName.trim();
    if (!name) {
      showToastMsg('⚠️ Tên nhóm không được để trống');
      return;
    }
    try {
      const res = await renameShopGroup(groupId, name);
      if (res.success) {
        showToastMsg(`✅ ${res.message}`);
        setEditingGroupId(null);
        loadShopGroups();
      } else {
        showToastMsg(`❌ ${res.message}`);
      }
    } catch (err: any) {
      showToastMsg(`❌ Lỗi đổi tên nhóm: ${err.message}`);
    }
  };

  const handleDeleteGroup = async (group: ShopGroup) => {
    if (!window.confirm(`Xóa nhóm "${group.name}" sẽ xóa luôn ${group.shops.length} shop trong nhóm. Bạn chắc chắn?`)) return;
    try {
      const res = await deleteShopGroup(group.id);
      if (res.success) {
        showToastMsg(`🗑️ ${res.message}`);
        loadShopGroups();
      } else {
        showToastMsg(`❌ ${res.message}`);
      }
    } catch (err: any) {
      showToastMsg(`❌ Lỗi xóa nhóm: ${err.message}`);
    }
  };

  const handleApplyGroup = async (group: ShopGroup) => {
    setApplyingGroupId(group.id);
    try {
      const res = await applyShopGroup(group.id);
      if (res.success) {
        showToastMsg(`✅ ${res.message}`);
        await loadSettings();
        loadData(true);
      } else {
        showToastMsg(`❌ ${res.message}`);
      }
    } catch (err: any) {
      showToastMsg(`❌ Lỗi áp dụng nhóm: ${err.message}`);
    } finally {
      setApplyingGroupId(null);
    }
  };

  const getNewShopForm = (groupId: number) => newShopForms[groupId] || { svCustomerId: '', name: '', phone: '', code: '' };

  const setNewShopFormField = (groupId: number, field: 'svCustomerId' | 'name' | 'phone' | 'code', value: string) => {
    setNewShopForms(prev => ({
      ...prev,
      [groupId]: { ...getNewShopForm(groupId), [field]: value }
    }));
  };

  const handleAddShop = async (groupId: number) => {
    const form = getNewShopForm(groupId);
    if (!form.svCustomerId.trim() || !form.name.trim()) {
      showToastMsg('⚠️ Vui lòng nhập ID Khách Hàng và Tên Shop');
      return;
    }
    try {
      const res = await createShop({ ...form, groupId });
      if (res.success) {
        showToastMsg(`✅ ${res.message}`);
        setNewShopForms(prev => ({ ...prev, [groupId]: { svCustomerId: '', name: '', phone: '', code: '' } }));
        loadShopGroups();
      } else {
        showToastMsg(`❌ ${res.message}`);
      }
    } catch (err: any) {
      showToastMsg(`❌ Lỗi thêm shop: ${err.message}`);
    }
  };

  const handleUpdateShopField = async (shop: Shop, field: 'name' | 'phone' | 'code', value: string) => {
    setShopGroupList(prev => prev.map(g => ({
      ...g,
      shops: g.shops.map(s => s.svCustomerId === shop.svCustomerId ? { ...s, [field]: value } : s)
    })));
    try {
      await updateShop(shop.svCustomerId, { ...shop, [field]: value });
    } catch (err: any) {
      showToastMsg(`❌ Lỗi cập nhật shop: ${err.message}`);
    }
  };

  const handleDeleteShop = async (shop: Shop) => {
    if (!window.confirm(`Xóa shop "${shop.name}" (ID: ${shop.svCustomerId}) khỏi hệ thống?`)) return;
    try {
      const res = await deleteShop(shop.svCustomerId);
      if (res.success) {
        showToastMsg(`🗑️ ${res.message}`);
        loadShopGroups();
      } else {
        showToastMsg(`❌ ${res.message}`);
      }
    } catch (err: any) {
      showToastMsg(`❌ Lỗi xóa shop: ${err.message}`);
    }
  };

  const handleMoveShopToGroup = async (shop: Shop, newGroupIdRaw: string) => {
    const newGroupId = newGroupIdRaw === '' ? null : parseInt(newGroupIdRaw, 10);
    if (newGroupId === shop.groupId) return;
    try {
      const res = await updateShop(shop.svCustomerId, { ...shop, groupId: newGroupId });
      if (res.success) {
        showToastMsg(`✅ Đã chuyển "${shop.name}" sang nhóm khác`);
        loadShopGroups();
      } else {
        showToastMsg(`❌ ${res.message}`);
      }
    } catch (err: any) {
      showToastMsg(`❌ Lỗi chuyển nhóm: ${err.message}`);
    }
  };

  const toggleGroupExpand = (groupId: number) => {
    setExpandedGroupIds(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  };

  const shopMatchesSearch = (shop: Shop, query: string) => {
    const q = query.toLowerCase();
    return (
      shop.svCustomerId.toLowerCase().includes(q) ||
      shop.name.toLowerCase().includes(q) ||
      (shop.phone || '').toLowerCase().includes(q) ||
      (shop.code || '').toLowerCase().includes(q)
    );
  };

  const handleApplyAllShops = async () => {
    const allShops = [...shopGroupList.flatMap(g => g.shops), ...ungroupedShops];
    if (allShops.length === 0) {
      showToastMsg('⚠️ Chưa có shop nào trong hệ thống để áp dụng');
      return;
    }
    setApplyingDashboardFilter(true);
    try {
      const customerIds = allShops.map(s => s.svCustomerId).join(',');
      const labelsMap: Record<string, string> = {};
      allShops.forEach(s => { labelsMap[s.svCustomerId] = s.name || s.svCustomerId; });
      const res = await saveSystemConfig({ customerIds, customerLabelsJson: JSON.stringify(labelsMap) });
      if (res.success) {
        showToastMsg(`✅ Đã áp dụng TẤT CẢ ${allShops.length} shop làm bộ lọc rà soát`);
        await loadSettings();
        loadData(true);
      } else {
        showToastMsg(`❌ ${res.message}`);
      }
    } catch (err: any) {
      showToastMsg(`❌ Lỗi áp dụng bộ lọc: ${err.message}`);
    } finally {
      setApplyingDashboardFilter(false);
    }
  };

  const handleSelectGroupFilter = async (groupId: number) => {
    setApplyingDashboardFilter(true);
    try {
      const res = await applyShopGroup(groupId);
      if (res.success) {
        showToastMsg(`✅ ${res.message}`);
        await loadSettings();
        loadData(true);
      } else {
        showToastMsg(`❌ ${res.message}`);
      }
    } catch (err: any) {
      showToastMsg(`❌ Lỗi áp dụng nhóm: ${err.message}`);
    } finally {
      setApplyingDashboardFilter(false);
    }
  };

  useEffect(() => {
    loadData();
    loadSettings();
    loadShopGroups();
  }, []);

  const handleRefresh = () => loadData(true, lookbackDays, pageSize);

  const handleCancelScan = async () => {
    try {
      const res = await cancelScan();
      showToastMsg(res.stopped ? `🛑 ${res.message}` : `ℹ️ ${res.message}`);
    } catch (err: any) {
      showToastMsg(`❌ Lỗi khi gửi yêu cầu dừng: ${err.message}`);
    }
  };

  const handleResetSession = async () => {
    setData(null); // Clear old UI data immediately so user sees visual reset
    setLoading(true);
    showToastMsg('🧹 Đang xóa bộ nhớ tạm & quét phiên dữ liệu mới từ SV Express...');
    try {
      const res = await resetSessionApi(MIN_FETCH_THRESHOLD, lookbackDays, pageSize);
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

  // Client-side only: instantly re-filters the already-fetched dataset, no API call.
  const handleThresholdChange = (val: string) => {
    setThreshold(val);
  };

  // These two change what's fetched from SV Express, so they still trigger a re-scan.
  const handleLookbackChange = (val: string) => {
    setLookbackDays(val);
    loadData(true, val, pageSize);
  };

  const handlePageSizeChange = (val: string) => {
    setPageSize(val);
    loadData(true, lookbackDays, val);
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

  // Recomputed client-side from the threshold-filtered order list (see thresholdFilteredOrders
  // below) instead of the server's partnerSummary, since threshold is now a local display filter.
  const computeLivePartnerSummary = (orders: StuckOrder[]) => {
    const summary: Record<string, { count: number; maxHoursStuck: number }> = {};
    orders.forEach((o) => {
      if (!summary[o.partnerName]) summary[o.partnerName] = { count: 0, maxHoursStuck: 0 };
      summary[o.partnerName].count += 1;
      summary[o.partnerName].maxHoursStuck = Math.max(summary[o.partnerName].maxHoursStuck, o.hoursStuck);
    });
    return summary;
  };

  const getPartnerStats = (summary: Record<string, { count: number; maxHoursStuck: number }>, keys: string[]) => {
    let count = 0;
    let maxHours = 0;
    Object.keys(summary).forEach(pName => {
      if (keys.some(k => pName.toUpperCase().includes(k))) {
        count += summary[pName].count;
        maxHours = Math.max(maxHours, summary[pName].maxHoursStuck);
      }
    });
    return { count, maxHours };
  };

  const getOtherPartnerStats = (summary: Record<string, { count: number; maxHoursStuck: number }>, excludeKeys: string[]) => {
    let count = 0;
    let maxHours = 0;
    Object.keys(summary).forEach(pName => {
      if (!excludeKeys.some(k => pName.toUpperCase().includes(k))) {
        count += summary[pName].count;
        maxHours = Math.max(maxHours, summary[pName].maxHoursStuck);
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
    if (pUpper.includes('GHN')) {
      return `https://donhang.ghn.vn/?order_code=${encodeURIComponent(billCode)}`;
    }
    if (pUpper === 'VT' || pUpper.includes('VIETTEL') || pUpper.includes('VTPOST')) {
      return `https://viettelpost.com.vn/tra-cuu-hanh-trinh-don/`;
    }
    return '';
  };

  // GHN & Viettel Post's public tracking pages require manually pasting the tracking
  // code (no deep-link support like J&T/SPX's API endpoints) - auto-copy it on open.
  const isManualEntryCarrier = (partnerName: string): boolean => {
    const pUpper = (partnerName || '').toUpperCase();
    return pUpper.includes('GHN') || pUpper === 'VT' || pUpper.includes('VIETTEL') || pUpper.includes('VTPOST');
  };

  const handleOpenCarrierTracking = (e: React.MouseEvent, partnerName: string, billCode: string) => {
    e.stopPropagation();
    if (isManualEntryCarrier(partnerName)) {
      copyToClipboard(billCode, 'Mã Vận Đơn (dán vào ô tra cứu trên trang vừa mở)');
    }
  };

  // Threshold is a pure client-side filter over the already-fetched dataset (fetched once at
  // MIN_FETCH_THRESHOLD) - changing it never re-hits the API.
  const thresholdValue = parseFloat(threshold) || 0;
  const thresholdFilteredOrders = (data?.stuckOrders || []).filter(o => o.hoursStuck >= thresholdValue);
  const livePartnerSummary = computeLivePartnerSummary(thresholdFilteredOrders);

  const jtStats = getPartnerStats(livePartnerSummary, ['J&T', 'JT', 'JAT']);
  const spxStats = getPartnerStats(livePartnerSummary, ['SPX', 'SHOPEE']);
  const otherStats = getOtherPartnerStats(livePartnerSummary, ['J&T', 'JT', 'JAT', 'SPX', 'SHOPEE']);

  const totalShopCount = shopGroupList.reduce((sum, g) => sum + g.shops.length, 0) + ungroupedShops.length;
  const currentCustomerIds = (configForm.customerIds || '').split(',').map(s => s.trim()).filter(Boolean);
  const currentCustomerIdSet = new Set(currentCustomerIds);
  const activeGroup = shopGroupList.find(g => {
    if (g.shops.length === 0 || g.shops.length !== currentCustomerIdSet.size) return false;
    return g.shops.every(s => currentCustomerIdSet.has(s.svCustomerId));
  });
  const isAllShopsActive = totalShopCount > 0 && currentCustomerIdSet.size === totalShopCount &&
    [...shopGroupList.flatMap(g => g.shops), ...ungroupedShops].every(s => currentCustomerIdSet.has(s.svCustomerId));

  const filteredOrders = thresholdFilteredOrders.filter(o => {
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
            className={`nav-tab-btn ${activeNav === 'shopGroups' ? 'active' : ''}`}
            onClick={() => setActiveNav('shopGroups')}
          >
            🏪 Quản Lý Nhóm Shop
          </button>
          <button
            className={`nav-tab-btn ${activeNav === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveNav('settings')}
          >
            ⚙️ Cài Đặt Hệ Thống
          </button>
        </div>

        <div className="nav-actions">
          {loading && (
            <button onClick={handleCancelScan} className="btn btn-danger" title="Dừng ngay phiên quét đơn hàng đang chạy">
              <span>⏹️</span> Dừng Quét
            </button>
          )}
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
              <div className="stat-value">{thresholdFilteredOrders.length}</div>
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
                Tất cả NVC ({thresholdFilteredOrders.length})
              </button>
              {Object.keys(livePartnerSummary).map(p => (
                <button
                  key={p}
                  className={`tab-btn ${activeCarrier === p ? 'active' : ''}`}
                  onClick={() => setActiveCarrier(p)}
                >
                  {p} ({livePartnerSummary[p].count})
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
          </section>

          {/* Filter Controls - Button Groups */}
          <section className="control-panel">
            <div className="control-row">
              <span className="control-label">🏪 Rà soát theo nhóm:</span>
              <div className="btn-group" style={{ opacity: applyingDashboardFilter ? 0.6 : 1, pointerEvents: applyingDashboardFilter ? 'none' : 'auto' }}>
                {shopGroupList.map(g => (
                  <button
                    key={g.id}
                    className={`btn-chip ${activeGroup?.id === g.id ? 'active' : ''}`}
                    onClick={() => handleSelectGroupFilter(g.id)}
                    disabled={applyingDashboardFilter}
                  >
                    {g.name} ({g.shops.length})
                  </button>
                ))}
                {totalShopCount > 0 && (
                  <button
                    className={`btn-chip ${isAllShopsActive ? 'active' : ''}`}
                    onClick={handleApplyAllShops}
                    disabled={applyingDashboardFilter}
                  >
                    🌐 Tất cả Shop ({totalShopCount})
                  </button>
                )}
              </div>
              {applyingDashboardFilter && <span className="control-hint">⏳ Đang áp dụng & quét lại...</span>}
              {!applyingDashboardFilter && !activeGroup && !isAllShopsActive && (
                <span className="control-hint">🎯 Đang dùng bộ lọc tùy chỉnh ({currentCustomerIdSet.size} shop)</span>
              )}
            </div>

            <div className="control-row">
              <span className="control-label">⏱️ Ngưỡng ngâm <em>(lọc tức thì, không gọi lại API)</em>:</span>
              <div className="btn-group">
                {THRESHOLD_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`btn-chip ${threshold === opt.value ? 'active' : ''}`}
                    onClick={() => handleThresholdChange(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="control-row">
              <span className="control-label">📅 Thời gian quét:</span>
              <div className="btn-group" style={{ opacity: loading ? 0.6 : 1, pointerEvents: loading ? 'none' : 'auto' }}>
                {LOOKBACK_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`btn-chip ${lookbackDays === opt.value ? 'active' : ''}`}
                    onClick={() => handleLookbackChange(opt.value)}
                    disabled={loading}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="control-row secondary-row">
              <span className="control-label">📄 Số đơn/trang:</span>
              <div className="btn-group">
                {PAGE_SIZE_OPTIONS.map(v => (
                  <button
                    key={v}
                    className={`btn-chip small ${pageSize === v ? 'active' : ''}`}
                    onClick={() => handlePageSizeChange(v)}
                    disabled={loading}
                  >
                    {v}
                  </button>
                ))}
              </div>
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
                            onClick={(e) => handleOpenCarrierTracking(e, o.partnerName, o.partnerCode)}
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
                                  onClick={(e) => handleOpenCarrierTracking(e, o.partnerName, o.partnerCode)}
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
                                  onClick={(e) => handleOpenCarrierTracking(e, o.partnerName, o.partnerCode)}
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
              <h2>🏷️ Quản Lý Trạng Thái Lọc Đơn Hàng</h2>
              <p className="categories-subtitle">
                Thêm / Sửa / Xóa danh sách <b>ID Trạng Thái</b> đơn hàng cần quét từ SV Express API.
                <br />
                💡 Danh mục <b>ID Khách Hàng / Shop</b> giờ được quản lý gọn hơn tại tab <b>🏪 Quản Lý Nhóm Shop</b>.
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

          <div className="categories-grid single-column">
            {/* STATUS IDS MANAGEMENT */}
            <div className="category-card">
              <div className="card-header">
                <h3>🏷️ Danh Mục ID Trạng Thái Cần Lọc (Status IDs)</h3>
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
              <span>{savingConfig ? '⏳' : '💾'}</span> {savingConfig ? 'Đang lưu...' : 'Lưu & Áp Dụng Danh Mục Trạng Thái'}
            </button>
          </div>
        </section>
      )}

      {/* VIEW 2.5: SHOP GROUPS MANAGEMENT TAB */}
      {activeNav === 'shopGroups' && (
        <section className="categories-container">
          <div className="categories-header-bar">
            <div>
              <h2>🏪 Quản Lý Nhóm Shop</h2>
              <p className="categories-subtitle">
                Tổ chức shop thành từng nhóm để rà soát tiện lợi. Bấm vào tên nhóm để xem/ẩn danh sách shop.
                Sang tab <b>📊 Bảng Thống Kê</b> để chọn nhóm cần rà soát trực tiếp.
              </p>
            </div>
            <div className="add-item-form" style={{ margin: 0, padding: 0, background: 'transparent', border: 'none' }}>
              <div className="form-row">
                <div className="form-group flex-2">
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={e => setNewGroupName(e.target.value)}
                    placeholder="Tên nhóm mới, VD: Nhóm 6: SPX"
                    onKeyDown={e => e.key === 'Enter' && handleCreateGroup()}
                  />
                </div>
                <button type="button" onClick={handleCreateGroup} className="btn btn-success btn-add-inline">
                  ➕ Tạo Nhóm
                </button>
              </div>
            </div>
          </div>

          {/* Summary Overview Bar */}
          <div className="shop-groups-summary">
            <div className="summary-chip">
              <span className="summary-chip-value">{shopGroupList.length}</span>
              <span className="summary-chip-label">Nhóm Shop</span>
            </div>
            <div className="summary-chip">
              <span className="summary-chip-value">{totalShopCount}</span>
              <span className="summary-chip-label">Tổng Số Shop</span>
            </div>
            <div className="summary-chip active-filter-chip">
              <span className="summary-chip-value" style={{ fontSize: '14px' }}>
                {isAllShopsActive ? '🌐 Tất cả' : activeGroup ? `✅ ${activeGroup.name}` : `🎯 Tùy chỉnh`}
              </span>
              <span className="summary-chip-label">Đang Rà Soát ({currentCustomerIdSet.size} shop)</span>
            </div>
            <div className="search-box" style={{ maxWidth: '320px' }}>
              <span className="search-icon">🔍</span>
              <input
                type="text"
                placeholder="Tìm shop theo tên, ID, SĐT..."
                value={shopSearchQuery}
                onChange={e => setShopSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {loadingShopGroups && shopGroupList.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>⌛ Đang tải danh sách nhóm shop...</p>
          ) : shopGroupList.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>📭 Chưa có nhóm shop nào. Hãy tạo nhóm đầu tiên ở trên.</p>
          ) : (
            shopGroupList.map(group => {
              const form = getNewShopForm(group.id);
              const isEditingThisGroup = editingGroupId === group.id;
              const isApplyingThisGroup = applyingGroupId === group.id;
              const isThisGroupActive = activeGroup?.id === group.id;
              const query = shopSearchQuery.trim().toLowerCase();
              const hasMatch = query !== '' && group.shops.some(s => shopMatchesSearch(s, query));
              const isExpanded = expandedGroupIds.has(group.id) || hasMatch;
              const visibleShops = query ? group.shops.filter(s => shopMatchesSearch(s, query)) : group.shops;

              return (
                <div key={group.id} className={`shop-group-card ${isThisGroupActive ? 'is-active-group' : ''}`}>
                  <div className="shop-group-header" onClick={() => toggleGroupExpand(group.id)}>
                    <span className={`accordion-chevron ${isExpanded ? 'open' : ''}`}>▶</span>
                    <div className="shop-group-title">
                      {isEditingThisGroup ? (
                        <div style={{ display: 'flex', gap: '8px' }} onClick={e => e.stopPropagation()}>
                          <input
                            type="text"
                            value={editingGroupName}
                            onChange={e => setEditingGroupName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSaveRenameGroup(group.id)}
                            autoFocus
                          />
                          <button type="button" className="btn btn-success" onClick={() => handleSaveRenameGroup(group.id)}>💾</button>
                          <button type="button" className="btn btn-secondary" onClick={() => setEditingGroupId(null)}>✕</button>
                        </div>
                      ) : (
                        <h3>
                          🗂️ {group.name}
                          {isThisGroupActive && <span className="badge-active-group">ĐANG RÀ SOÁT</span>}
                          <span
                            className="btn-inline-rename"
                            onClick={e => { e.stopPropagation(); handleStartRenameGroup(group); }}
                            title="Đổi tên nhóm"
                          >
                            ✏️
                          </span>
                        </h3>
                      )}
                      <span className="card-desc">{group.shops.length} shop trong nhóm</span>
                    </div>
                    <div className="shop-group-actions" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={isApplyingThisGroup || group.shops.length === 0}
                        onClick={() => handleApplyGroup(group)}
                        title="Đưa toàn bộ shop trong nhóm này vào bộ lọc ID Khách Hàng đang quét"
                      >
                        {isApplyingThisGroup ? '⏳...' : '✅ Áp Dụng'}
                      </button>
                      <button type="button" className="btn-action-delete" onClick={() => handleDeleteGroup(group)}>
                        🗑️
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="shop-group-body">
                      <div className="category-items-list">
                        <table className="category-table">
                          <thead>
                            <tr>
                              <th style={{ width: '50px', textAlign: 'center' }}>STT</th>
                              <th style={{ width: '110px' }}>ID Khách Hàng</th>
                              <th>Tên Shop</th>
                              <th style={{ width: '140px' }}>Số Điện Thoại</th>
                              <th style={{ width: '100px' }}>Mã GHSV</th>
                              <th style={{ width: '170px' }}>Chuyển Nhóm</th>
                              <th style={{ width: '60px', textAlign: 'center' }}>Xóa</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleShops.length === 0 ? (
                              <tr>
                                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                                  {query ? 'Không có shop nào khớp tìm kiếm.' : 'Chưa có shop nào trong nhóm này.'}
                                </td>
                              </tr>
                            ) : (
                              visibleShops.map((shop, idx) => (
                                <tr key={shop.svCustomerId}>
                                  <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                                  <td><span className="badge-id-code">{shop.svCustomerId}</span></td>
                                  <td>
                                    <input
                                      type="text"
                                      defaultValue={shop.name}
                                      className="input-inline-edit"
                                      onBlur={e => e.target.value !== shop.name && handleUpdateShopField(shop, 'name', e.target.value)}
                                    />
                                  </td>
                                  <td>
                                    <input
                                      type="text"
                                      defaultValue={shop.phone || ''}
                                      className="input-inline-edit"
                                      onBlur={e => e.target.value !== (shop.phone || '') && handleUpdateShopField(shop, 'phone', e.target.value)}
                                    />
                                  </td>
                                  <td>
                                    <input
                                      type="text"
                                      defaultValue={shop.code || ''}
                                      className="input-inline-edit"
                                      onBlur={e => e.target.value !== (shop.code || '') && handleUpdateShopField(shop, 'code', e.target.value)}
                                    />
                                  </td>
                                  <td>
                                    <select
                                      className="select-move-group"
                                      value={shop.groupId ?? ''}
                                      onChange={e => handleMoveShopToGroup(shop, e.target.value)}
                                    >
                                      <option value="">-- Chưa phân nhóm --</option>
                                      {shopGroupList.map(g => (
                                        <option key={g.id} value={g.id}>{g.name}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td style={{ textAlign: 'center' }}>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteShop(shop)}
                                      className="btn-action-delete"
                                      title="Xóa shop này"
                                    >
                                      🗑️
                                    </button>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>

                      <div className="add-item-form">
                        <div className="form-row">
                          <div className="form-group flex-1">
                            <input
                              type="text"
                              value={form.svCustomerId}
                              onChange={e => setNewShopFormField(group.id, 'svCustomerId', e.target.value)}
                              placeholder="ID Khách Hàng (*)"
                            />
                          </div>
                          <div className="form-group flex-2">
                            <input
                              type="text"
                              value={form.name}
                              onChange={e => setNewShopFormField(group.id, 'name', e.target.value)}
                              placeholder="Tên Shop (*)"
                            />
                          </div>
                          <div className="form-group flex-1">
                            <input
                              type="text"
                              value={form.phone}
                              onChange={e => setNewShopFormField(group.id, 'phone', e.target.value)}
                              placeholder="Số điện thoại"
                            />
                          </div>
                          <div className="form-group flex-1">
                            <input
                              type="text"
                              value={form.code}
                              onChange={e => setNewShopFormField(group.id, 'code', e.target.value)}
                              placeholder="Mã GHSV"
                            />
                          </div>
                          <button type="button" onClick={() => handleAddShop(group.id)} className="btn btn-success btn-add-inline">
                            ➕ Thêm Shop
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {ungroupedShops.length > 0 && (
            <div className="shop-group-card">
              <div className="shop-group-header" onClick={() => toggleGroupExpand(-1)}>
                <span className={`accordion-chevron ${expandedGroupIds.has(-1) ? 'open' : ''}`}>▶</span>
                <div className="shop-group-title">
                  <h3>❓ Shop Chưa Phân Nhóm</h3>
                  <span className="card-desc">{ungroupedShops.length} shop chưa thuộc nhóm nào</span>
                </div>
              </div>
              {expandedGroupIds.has(-1) && (
                <div className="shop-group-body">
                  <div className="category-items-list">
                    <table className="category-table">
                      <thead>
                        <tr>
                          <th style={{ width: '110px' }}>ID Khách Hàng</th>
                          <th>Tên Shop</th>
                          <th style={{ width: '140px' }}>Số Điện Thoại</th>
                          <th style={{ width: '170px' }}>Chuyển Nhóm</th>
                          <th style={{ width: '60px', textAlign: 'center' }}>Xóa</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ungroupedShops.map(shop => (
                          <tr key={shop.svCustomerId}>
                            <td><span className="badge-id-code">{shop.svCustomerId}</span></td>
                            <td>{shop.name}</td>
                            <td>{shop.phone}</td>
                            <td>
                              <select
                                className="select-move-group"
                                value=""
                                onChange={e => handleMoveShopToGroup(shop, e.target.value)}
                              >
                                <option value="">-- Chọn nhóm --</option>
                                {shopGroupList.map(g => (
                                  <option key={g.id} value={g.id}>{g.name}</option>
                                ))}
                              </select>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <button type="button" onClick={() => handleDeleteShop(shop)} className="btn-action-delete">🗑️</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
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
                  <label>Giới Hạn Số Trang Tối Đa Mỗi Lần Quét (An Toàn):</label>
                  <input
                    type="number"
                    value={configForm.maxScanPages || 300}
                    onChange={e => setConfigForm({ ...configForm, maxScanPages: parseInt(e.target.value, 10) || 300 })}
                    placeholder="300"
                    min="10"
                    max="5000"
                  />
                  <span className="hint">
                    ⚠️ Lưu ý: "Số đơn/trang" chỉ là kích thước mỗi lượt gọi API — hệ thống vẫn tự tải HẾT toàn bộ đơn khớp bộ lọc.
                    Đây mới là giới hạn TỔNG số trang tối đa để tránh quét vô hạn khi bộ lọc quá rộng (VD: 300 trang × 200 đơn/trang ≈ 60.000 đơn).
                    Nếu bị cắt bớt, hãy thu hẹp "Thời gian quét" / "ID Khách Hàng" hoặc tăng số này lên.
                  </span>
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
