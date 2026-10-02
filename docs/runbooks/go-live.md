# Runbook — Go-live / vận hành 1 kho

Audience: ops + IT tại kho pilot.
Bổ sung [deployment.md](../deployment.md) và [local-setup-windows.md](../local-setup-windows.md).

---

## 1. Start / stop (Docker Compose — khuyến nghị production/lab)

### Start

```bash
cd sentry-wms
cp .env.example .env   # lần đầu — điền secrets
docker compose up -d
docker compose ps
curl -s http://127.0.0.1:5000/api/health
```

Services chính: `db`, `api`, `redis`, `celery-worker`, `celery-beat`, `admin` (+ dispatcher nếu bật webhook).

### Stop

```bash
docker compose down
```

Giữ volume DB: **không** thêm `-v` trừ khi cố ý xoá dữ liệu.

### Restart sau deploy code

```bash
git pull
docker compose down
docker compose build
docker compose up -d
```

---

## 2. Start / stop (Windows local — không Docker)

| Terminal | Lệnh |
|----------|------|
| API | `.\scripts\start-api.ps1` → `:5000` |
| Admin | `.\scripts\start-admin.ps1` → `:3000` |
| Celery worker | trong `api\`: `.\.venv\Scripts\celery.exe -A jobs worker --loglevel=info --pool=solo` |
| Celery beat | `.\.venv\Scripts\celery.exe -A jobs beat --loglevel=info` |

**Stale API (Windows):** nếu endpoint mới 404 dù code đã sửa — process cũ còn chiếm port 5000:

```powershell
Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue |
  Select-Object OwningProcess
Stop-Process -Id <pid> -Force
.\scripts\start-api.ps1
```

---

## 3. Migration order

### Fresh install

`db/schema.sql` (qua `seed` / `init-db`) đã gồm schema đầy đủ — **không** cần chạy từng file 001…086.

### Upgrade kho đang chạy

Chạy file trong `db/migrations/` **theo số tăng dần**, chỉ các migration chưa apply.

3PL / digitization gần đây (bắt buộc nếu chưa có):

| # | File | Nội dung |
|---|------|----------|
| 078 | `078_create_pallets.sql` | Bảng pallets |
| 079 | `079_billing.sql` | Billing events / invoices |
| 080 | `080_vehicle_movements.sql` | Vehicle movements |
| 081 | `081_pallet_customer.sql` | Pallet ↔ customer |
| 082 | `082_pallet_expiry_fefo.sql` | Expiry / FEFO |
| 083 | `083_warehouse_layout.sql` | Layout |
| 084 | `084_warehouse_layout_phase2.sql` | Layout phase 2 |
| 085 | `085_customer_contracts_billing.sql` | Contracts |
| 086 | `086_vehicle_gate_sessions.sql` | Gate sessions |

Docker:

```bash
for m in 078 079 080 081 082 083 084 085 086; do
  docker compose exec db psql -U sentry -d sentry \
    -f /db/migrations/${m}_*.sql
done
```

Windows (psql local):

```powershell
$env:PGPASSWORD = "..."
foreach ($m in 78..86) {
  $f = Get-ChildItem "db\migrations\$($m.ToString('000'))_*.sql"
  psql -U sentry -d sentry -f $f.FullName
}
```

Trước khi apply: backup DB. Sau khi apply: restart API + smoke `/api/health` + mở Simulation / Pallets / Invoices.

---

## 4. Celery beat schedule

Nguồn: `api/jobs/__init__.py` → `celery_app.conf.beat_schedule`.

| Entry | Task | Chu kỳ |
|-------|------|--------|
| cleanup-login-attempts-every-15-min | `jobs.cleanup_tasks.cleanup_login_attempts` | 15 phút |
| cleanup-webhook-deliveries-every-6-hours | `jobs.cleanup_tasks.cleanup_webhook_deliveries` | 6 giờ |
| cleanup-expired-webhook-secrets-every-hour | `jobs.cleanup_tasks.cleanup_expired_webhook_secrets` | 1 giờ |
| cleanup-inbound-source-payload-daily | `jobs.cleanup_tasks.cleanup_inbound_source_payload` | 24 giờ |
| cleanup-dockd-idempotency-daily | `jobs.cleanup_tasks.cleanup_dockd_idempotency` | 24 giờ |
| **billing-storage-daily** | `jobs.billing_tasks.daily_storage_billing` | 24 giờ |
| **expiry-daily** | `jobs.expiry_tasks.daily_expiry_scan` | 24 giờ |

**Lưu ý:** chỉ chạy `celery worker` **không** đủ — phải có **beat** thì storage billing và expiry mới tự chạy.

Chạy tay (ops / UAT):

```bash
docker compose exec celery-worker celery -A jobs call jobs.billing_tasks.daily_storage_billing
docker compose exec celery-worker celery -A jobs call jobs.expiry_tasks.daily_expiry_scan
```

Timezone beat: UTC (`enable_utc=True`). Điều chỉnh cửa sổ ngày billing theo kho nếu cần.

---

## 5. Health checklist buổi sáng

1. `GET /api/health` → 200  
2. `docker compose ps` — api, db, redis, celery-worker, celery-beat healthy  
3. Admin login + Simulation load được layout  
4. Mobile login + Home hiện đúng module theo persona  
5. (Nếu 3PL) 1 PO mở sẵn cho ca nhận; Celery beat không restart loop  

---

## 6. Sự cố thường gặp

| Triệu chứng | Hướng xử lý |
|-------------|-------------|
| PDF hợp đồng/HĐ 404 | API stale / chưa rebuild; font Unicode (`utils/pdf.py`) |
| Billing không phát sinh | Beat tắt; rate card/contract hết hạn; pallet không gắn customer |
| Expiry không quarantine | Beat tắt; `expiry_date` null trên inventory |
| Gate check-in 400 | PO/SO sai trạng thái hoặc không thuộc warehouse |
| Admin 403 trên trang mới | Thiếu `page_key` trên user USER — xem [role-matrix.md](../role-matrix.md) |

---

## 7. Liên kết Phase 6

- UAT: [uat-test-cases.md](../uat-test-cases.md)
- Roles: [role-matrix.md](../role-matrix.md)
- Training: [training-flows.md](../training-flows.md)
- Patterns: [patterns.md](../patterns.md)
