# 社畜加班紀錄器 - 後端 API

基於 Node.js + Express + Google Sheets API 的後端服務。
將你的 Google Sheet 變身為專屬資料庫，免費、穩定且可視化。

## ✨ 功能特色

- **RESTful API**: 提供完整的 CRUD 介面。
- **Google Sheets DB**: 資料直接寫入試算表，方便管理者直接在 Excel 介面查看或修正。
- **JWT Authentication**: 支援使用者註冊與登入驗證。
- **Environment Config**: 透過 `.env` 彈性配置金鑰與試算表 ID。

## 🛠 技術棧

- Node.js
- Express.js
- Googleapis (Sheets API v4)
- JSONWebToken (JWT)
- CORS

## 🚀 快速開始

### 1. 安裝依賴

```bash
cd Overwork-backend
npm install
```

### 2. Google Sheets 設定

此專案需要一個 Google Sheet 作為資料庫，請依照以下結構建立兩個工作表 (Worksheets)：

**工作表 1: `users`** (儲存使用者資料)
| id | username | password | display_name |
|----|----------|----------|--------------|
| user-123 | admin | 1234 | 管理員 |

**工作表 2: `worklogs`** (儲存加班紀錄)
| id | user_id | date | duration_hours | reason | notes |
|----|---------|------|----------------|--------|-------|
| log-456| user-123| 2023-10-20 | 2.5 | 趕專案 | 很累 |

> 💡 **提示**: 第一次啟動時，若 Sheet 是空的，程式會嘗試自動寫入標題列 (Header)。

### 3. 環境變數 (.env)

複製 `.env.example` 為 `.env` 並填入以下資訊：

```ini
PORT=3000
# JWT 設定
JWT_SECRET=your_super_secret_key
JWT_EXPIRES_IN=365d

# Google Sheet ID (從試算表網址取得)
GOOGLE_SHEET_ID=1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Google Service Account Credentials (GCP 服務帳號金鑰)
GOOGLE_SA_Type=service_account
GOOGLE_SA_PROJECT_ID=...
GOOGLE_SA_PRIVATE_KEY_ID=...
GOOGLE_SA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
GOOGLE_SA_CLIENT_EMAIL=...
GOOGLE_SA_CLIENT_ID=...
```

### 4. 啟動伺服器

```bash
# 開發模式
npm run dev

# 正式環境
node app.js
```

## 📡 API 文件

### Auth
- `POST /auth/register`: 註冊新帳號 `{ username, password, display_name }`
- `POST /auth/login`: 登入 `{ username, password }` -> 回傳 `token`

### Worklogs (需帶 Bearer Token)
- `GET /api/worklogs`: 取得當前使用者的所有紀錄
- `POST /api/worklogs`: 新增紀錄 `{ date, duration_hours, reason, notes }`
- `PUT /api/worklogs/:id`: 修改紀錄
- `DELETE /api/worklogs/:id`: 刪除紀錄

## ☁️ 部署 (Zeabur / Render)

1. 將代碼推送到 GitHub。
2. 在部署服務 (如 Zeabur) 新增專案。
3. 設定環境變數 (Environment Variables)，將 `.env` 內容填入。
   - **注意**: `GOOGLE_SA_PRIVATE_KEY` 若包含換行符號，在某些平台需特別處理（如將 `\n` 替換為實際換行，或使用 Base64 編碼後在程式內解碼）。本專案代碼已包含 `replace(/\\n/g, "\n")` 處理。

## License

MIT
