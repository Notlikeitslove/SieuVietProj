# Auto Check Đơn Hàng GHSV (NestJS Backend + ReactJS Frontend)

Hệ thống Fullstack chuyên nghiệp sử dụng **NestJS (TypeScript)** làm Backend API Server và **ReactJS (Vite + TypeScript)** làm Frontend Web Dashboard. 

---

## 🚀 Bộ Lệnh Rút Gọn Nhanh (Short Commands)

### 1. Cài đặt toàn bộ thư viện
```bash
npm run i:all
```

### 2. Khởi chạy Development (BE + FE cùng lúc)
- **Chạy song song cả Backend & Frontend trong 1 Cửa sổ Terminal**:
  ```bash
  npm start
  # Hoặc: npm run dev
  ```
  *(NestJS Backend tại `http://localhost:3000` & ReactJS Dashboard tại `http://localhost:5173`)*

- **Chạy riêng biệt từng ứng dụng (nếu cần)**:
  - Chỉ chạy Backend NestJS: `npm run be`
  - Chỉ chạy Frontend ReactJS: `npm run fe`

### 3. Build Production
- **Build Backend**: `npm run build:be`
- **Build Frontend**: `npm run build:fe`
- **Build Tất Cả**: `npm run build:all`

---

## 🏗️ Cấu Trúc Thư Mục Dự Án

```text
SieuVietProj/
├── backend/                 # NESTJS BACKEND API SERVER (TypeScript)
│   ├── src/
│   │   ├── config/          # Configuration module (@nestjs/config)
│   │   ├── auth/            # AuthService: Tự động login & verify token (GET /v1/announcement/me)
│   │   ├── tracking/        # TrackingService: Tra cứu bưu cục public J&T & SPX
│   │   ├── orders/          # OrdersModule: OrdersController & OrdersService (Quét đơn, Gom nhóm NVC, Excel)
│   │   ├── telegram/        # TelegramService: Bot Telegram 2 chiều (/check, /excel, /status)
│   │   ├── cron/            # CronService: Lịch tự động chạy 8h & 14h hàng ngày (@nestjs/schedule)
│   │   ├── app.module.ts    # Root NestJS Module
│   │   └── main.ts          # NestJS Entrypoint (Port 3000)
│   ├── tsconfig.json
│   └── package.json
│
├── frontend/                # REACTJS FRONTEND WEB DASHBOARD (Vite)
│   ├── src/
│   │   ├── services/        # API Client kết nối tới NestJS API Backend
│   │   ├── styles/          # Dark Glassmorphism CSS
│   │   ├── App.tsx          # React Dashboard Component (Stat Cards, Tabs NVC, Search, Table)
│   │   ├── main.tsx         # React Entrypoint
│   │   └── index.css
│   ├── index.html
│   ├── vite.config.ts       # Config Proxy API tới NestJS Backend (Port 5173)
│   └── package.json
│
├── exports/                 # Thư mục chứa các file báo cáo Excel xuất ra
├── logs/                    # Thư mục lưu log ứng dụng PM2
├── .env                     # File biến môi trường chứa tài khoản & token
├── ecosystem.config.js      # Cấu hình PM2 chạy ngầm NestJS trên Ubuntu Server
├── package.json             # Root scripts điều khiển gọn nhẹ
├── README.md                # Tài liệu hướng dẫn nhanh
└── SV_doc.md                # Tài liệu chi tiết hướng dẫn & giới thiệu chức năng
```

---

## 🤖 Bộ Lệnh Telegram Bot

- `/check`: Quét đơn ngâm lập tức & báo cáo theo NVC.
- `/excel`: **Gửi file báo cáo `.xlsx` trực tiếp** vào chat Telegram.
- `/status`: Xem trạng thái hệ thống, ngưỡng ngâm & lịch Cron.

---

## 🐧 Triển Khai Trên Server Ubuntu (PM2)

```bash
# Build dự án
npm run build:all

# Khởi chạy ngầm 24/7 bằng PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```
