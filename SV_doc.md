# 🚀 SV EXPRESS AUTO CHECK ORDER JOURNEY - DỰ ÁN HƯỚNG DẪN & GIỚI THIỆU CHỨC NĂNG

Hệ thống tự động kiểm tra hành trình đơn hàng SV Express (**Auto Check Order Journey**) được xây dựng theo kiến trúc **Fullstack Monorepo hiện đại**:
- **Backend**: NestJS (TypeScript, Modular Architecture, SQLite Database, AES-256 Encryption, Axios, ExcelJS, Telegraf/Telegram Bot, Schedule Cron).
- **Frontend**: ReactJS (Vite, TypeScript, Dynamic Glassmorphism Dark Theme, Axios Client).

---

## 🎯 1. GIỚI THIỆU TỔNG QUAN DỰ ÁN

Trong hoạt động giao nhận vận chuyển, việc đơn hàng bị ngâm ("stuck") ở trạng thái **"Đang chuyển kho giao"** quá lâu mà không giao tới người nhận sẽ gây ra trải nghiệm xấu cho khách hàng và tăng tỷ lệ hoàn đơn.

**Hệ thống SV Express Auto Check Order Journey** giải quyết bài toán trên bằng cách:
1. Tự động kết nối với API SV Express (`https://api.svexpress.vn/v1/order`) để quét tất cả đơn hàng phát sinh.
2. Tự động lọc các đơn bị ngâm quá ngưỡng thời gian quy định (ví dụ: `>= 24 giờ`, `>= 48 giờ`...).
3. Tự động tra cứu trực tiếp vị trí bưu cục / trạm giữ hàng thông qua **Public Tracking API** của các nhà vận chuyển (J&T Express, SPX Express...).
4. Gửi báo cáo thông minh, hỗ trợ nhận bộ lệnh điều khiển 2 chiều qua **Telegram Bot** (`/check`, `/excel`, `/status`, `/setthreshold`, `/cron`, `/help`).
5. Xuất báo cáo file Excel (`.xlsx`) được định dạng chuyên nghiệp với các mức highlight màu sắc theo độ ngâm hàng.

---

## 🔥 2. BỘ CHỨC NĂNG NỔI BẬT

### 🖥️ 2.1. Chi Tiết Log Quét Từng Trang & Thống Kê Đơn Đáp Ứng / Không Đáp Ứng
- **Nhật ký thời gian thực theo từng trang API**:
  - `📄 [Trang 1]: Tải về thành công X đơn hàng.`
  - `📊 [THỐNG KÊ CHI TIẾT PHÂN TÍCH ĐƠN HÀNG]`
  - `   ├─ 📥 Tổng số đơn đã lấy từ API: X đơn`
  - `   ├─ 🚨 ĐÁP ỨNG ĐIỀU KIỆN (Bị ngâm >= 24h): Y đơn (Đưa vào báo cáo)`
  - `   └─ ✅ KHÔNG ĐÁP ỨNG (Ngâm < 24h): Z đơn (Đã bỏ qua)`

### 📋 2.2. 1-Click Copy Mã GHSV & Mã Vận Đơn (Frontend)
- **Tự động sao chép mã**: Khi người dùng click chuột vào ô **Mã GHSV** hoặc **Mã Vận Đơn NVC** trên Bảng Thống Kê, hệ thống tự động copy chuỗi mã vào Clipboard và hiển thị thông báo toast: `📋 Đã sao chép Mã GHSV: ...` hoặc `📋 Đã sao chép Mã Vận Đơn NVC: ...`.

### ✈️ 2.3. Telegram Bot 2 Chiều Interactive & Bộ Lệnh Hướng Dẫn `/help`
- **Gửi câu lệnh `/help`**: Trả về menu hướng dẫn chi tiết toàn bộ các câu lệnh điều khiển Bot (`/check`, `/excel`, `/status`, `/setthreshold <số_giờ>`, `/cron <on|off>`, `/help`).

### 🌐 2.4. Link Tra Cứu Web Trực Tiếp Cho J&T Express & SPX Express
- **Mã Vận Đơn & Nút Tra Cứu Web**: Nhấp biểu tượng 🔗 hoặc nút `🌐 Tra cứu NVC` để mở thẳng trang tra cứu web chính thức của J&T (`jtexpress.vn/vi/tracking?type=track&billcode=...&cellphone=4SoCuoiSDT`) hoặc SPX (`spx.vn/track`). Tự động trích xuất 4 số cuối số điện thoại người nhận ghép vào tham số `cellphone` cho J&T.

### 🗄️ 2.5. Quản Lý Cấu Hình Động Qua SQLite DB & Mã Hóa Bảo Mật AES-256
- **Lưu trữ cấu hình trong SQLite**: Toàn bộ tham số cấu hình động được lưu trữ an toàn trong file cơ sở dữ liệu SQLite tại `backend/database/settings.sqlite`.

---

## 🛠️ 3. HƯỚNG DẪN CÀI ĐẶT & KHỞI CHẠY

```bash
# Cài đặt dependencies
npm run i:all

# Khởi chạy Development (BE + FE)
npm start

# Build sản phẩm Production
npm run build:all
```

---

## 📢 4. TỔNG KẾT & HỖ TRỢ

Hệ thống **SV Express Auto Check Order Journey** cung cấp giải pháp toàn diện giúp doanh nghiệp kiểm soát chặt chẽ các đơn hàng bị ngâm, nâng cao năng lực vận hành và giảm thiểu tối đa tỷ lệ thất thoát hoàn đơn.
