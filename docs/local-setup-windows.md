# Sơn Lộc WMS — Local setup (Windows, không Docker)

## Yêu cầu

| Thành phần | Phiên bản | Ghi chú |
|------------|-----------|---------|
| Python | 3.12+ | Đã cài |
| Node.js | 18+ | Đã cài |
| PostgreSQL | 16 | **Bắt buộc** — chưa có trên máy bạn |

Redis **không bắt buộc** cho dev local (dispatcher/publisher tắt trong `.env`).

---

## Bước 1 — Cài PostgreSQL 16

Chạy PowerShell **Run as Administrator**:

```powershell
winget install PostgreSQL.PostgreSQL.16 --accept-package-agreements --accept-source-agreements
```

Trong installer, đặt mật khẩu user `postgres` (ví dụ: `postgres`) và nhớ port `5432`.

Sau khi cài, thêm vào PATH (mở terminal mới):

```
C:\Program Files\PostgreSQL\16\bin
```

Kiểm tra:

```powershell
psql --version
Get-Service postgresql*
```

---

## Bước 2 — Cài dependencies (đã chạy một lần)

```powershell
cd d:\workspace\phuoc\WMS\sentry-wms
.\scripts\setup-local.ps1
```

Script này:

- Tạo `api\.venv` + `pip install -r requirements.txt`
- `npm install` trong `admin\`
- Tạo file `.env` với secrets

---

## Bước 3 — Cấu hình `.env`

Mở `sentry-wms\.env` và sửa nếu cần:

```env
POSTGRES_SUPERUSER_PASSWORD=<mật khẩu postgres bạn đặt khi cài>
```

---

## Bước 4 — Khởi tạo database

```powershell
cd d:\workspace\phuoc\WMS\sentry-wms
.\scripts\init-db.ps1
```

Tạo user `sentry`, database `sentry`, load schema + demo data (APT-LAB).

Login admin: **admin / admin**

---

## Bước 5 — Chạy app

**Terminal 1 — API:**

```powershell
.\scripts\start-api.ps1
```

→ http://localhost:5000/api/health

**Terminal 2 — Admin UI:**

```powershell
.\scripts\start-admin.ps1
```

→ http://localhost:3000  
Login: admin / admin  
Mở **Warehouse → Simulation** để xem mô phỏng kho.

---

## Lệnh nhanh

| Lệnh | Mô tả |
|------|--------|
| `.\scripts\setup-local.ps1` | Cài venv + npm + .env |
| `.\scripts\init-db.ps1` | Tạo DB + seed |
| `.\scripts\start-api.ps1` | Flask API :5000 |
| `.\scripts\start-admin.ps1` | Vite dev :3000 |

---

## Xử lý lỗi thường gặp

**`Cannot connect to PostgreSQL`**  
- Service chưa chạy: `Start-Service postgresql-x64-16`  
- Sai mật khẩu trong `.env` → sửa `POSTGRES_SUPERUSER_PASSWORD`

**API boot lỗi `JWT_SECRET`**  
- Chạy lại `.\scripts\generate-env.ps1` (xóa `.env` cũ trước)

**Admin 403 / không login**  
- API phải chạy trước; Vite proxy trỏ `http://127.0.0.1:5000`

**Muốn Redis sau này (connector sync)**  
- Cài [Memurai Developer](https://www.memurai.com/) hoặc `winget install Memurai.MemuraiDeveloper`  
- Bật `DISPATCHER_ENABLED=true` và set `CELERY_BROKER_URL` trong `.env`
