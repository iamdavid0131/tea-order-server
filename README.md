# 祥興茶行訂單後端伺服器

這是一個基於 Node.js + Express 的後端服務，用於處理祥興茶行的訂單管理，並使用 Google Sheets 作為資料儲存後端。

## 功能特點

- 提供 RESTful API 介面
- 整合 Google Sheets API 進行資料儲存
- CORS 支援
- 環境變數配置
- 日誌記錄

## 環境需求

- Node.js 14.x 或更高版本
- npm 6.x 或更高版本
- Google Cloud Platform 專案與啟用的 Google Sheets API
- 服務帳戶金鑰 (Service Account Key)

## 快速開始

1. 複製環境變數範例檔：
   ```bash
   cp .env.example .env
   ```

2. 設定環境變數 (`.env` 檔案)：
   - `GOOGLE_SHEETS_SHEET_ID`: Google 試算表 ID
   - `GOOGLE_SHEETS_CLIENT_EMAIL`: 服務帳戶電子郵件
   - `GOOGLE_SHEETS_PRIVATE_KEY`: 服務帳戶私鑰
   - `PORT`: 伺服器端口 (預設: 3000)
   - `NODE_ENV`: 執行環境 (development/production)
   - `CORS_ORIGIN`: 允許的來源網域 (例如: http://localhost:8080)

3. 安裝依賴：
   ```bash
   npm install
   ```

4. 啟動開發伺服器：
   ```bash
   npm run dev
   ```

## API 端點

### 取得設定
- `GET /api/config`
  - 從 Google Sheet 讀取設定資料

### 提交訂單
- `POST /api/order`
  - 接收訂單資料並寫入 Google Sheet

### 健康檢查
- `GET /health`
  - 檢查伺服器狀態

## 開發指令

- `npm run dev`: 啟動開發伺服器 (使用 nodemon)
- `npm start`: 啟動生產環境伺服器
- `npm test`: 執行測試 (待實作)

## Google Sheets 設定

1. 建立 Google Cloud 專案並啟用 Google Sheets API
2. 建立服務帳戶並下載 JSON 金鑰檔案
3. 將試算表分享給服務帳戶的電子郵件
4. 在 `.env` 中設定相關憑證

## 授權

MIT
