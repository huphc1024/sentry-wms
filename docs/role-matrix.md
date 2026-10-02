# Role matrix — Go-live 1 kho

Nhân viên có 2 **role DB**: `ADMIN` và `USER`.
Các vai trò vận hành dưới đây là **persona** — gán qua:

1. `role` = `ADMIN` hoặc `USER`
2. `allowed_functions` (mobile)
3. `page_keys` (web admin) — USER bắt buộc; ADMIN bypass toàn bộ

Preset tương ứng nằm trên form **Users** (nút Apply preset).

Nguồn khóa trang: `api/constants.py` → `ALL_PAGE_KEYS` / `ALL_OVERRIDE_KEYS`.

**Khách hàng không nằm trong hệ thống trên.** Tài khoản cổng khách hàng
sống ở bảng riêng `customer_users` với bộ quyền riêng (`feature_key`),
không có `role`, không có `page_keys`, không có `warehouse_ids` — xem
[Customer (portal)](#customer-portal) ở cuối tài liệu. Hai lớp tách bảng
để không tồn tại đường nào cho tài khoản khách leo vào quyền nhân viên.

---

## Tóm tắt

| Persona | DB role | Mobile | Web admin | Override |
|---------|---------|--------|-----------|----------|
| **Admin** | `ADMIN` | All | Full (bypass) | Implicit full |
| **Supervisor** | `USER` | All floor | Ops + inventory + expiry/gate | Không (mặc định) |
| **Picker** | `USER` | pick, pack, ship, map | Tối thiểu / không | Không |
| **Billing clerk** | `USER` | (trống) | `dashboard` + `billing` | Không |
| **Receiver** (tuỳ chọn) | `USER` | receive, putaway, map | Inbound + pallets + gate | Không |
| **Customer (portal)** | — (`customer_users`) | Không | Không | Không — chỉ `feature_key` trên cổng khách |

---

## Chi tiết page_keys

### Admin

- `role = ADMIN` — không cần gán `page_keys` (server trả full catalog).
- Dùng cho IT / quản trị kho cấp cao.

### Supervisor

```
dashboard, inventory, cycle-counts, count-approvals,
purchase-orders, receiving, putaway,
sales-orders, backorders, fraud, picking-tickets, picking-batches,
items, vendors, adjustments,
warehouses, bins, zones, preferred-bins,
pallets, expiry, vehicle-movements, warehouse-simulation,
notifications, audit-log
```

Mobile: `pick, pack, ship, receive, putaway, count, transfer, map`

Không gán mặc định: `users`, `settings`, `api-tokens`, `billing`, `webhooks`, `integrations`, `imports`, `channels`, `inbound`, `consumer-groups`, `pos-activity`, `inter-warehouse-transfers`, `transfer-orders`, overrides.

Có thể thêm `warehouse-map-edit` nếu supervisor được sửa sơ đồ kho.

### Picker

```
dashboard, inventory, warehouse-simulation
```

(hoặc để trống page_keys nếu picker **không** dùng web admin)

Mobile: `pick, pack, ship, map`

### Billing clerk

```
dashboard, billing
```

Mobile: (không)

`billing` mở Customers, Contracts, Rate Cards, Invoices trên sidebar.

### Receiver (tuỳ chọn — inbound dock)

```
dashboard, purchase-orders, receiving, putaway,
pallets, vehicle-movements, warehouse-simulation, inventory
```

Mobile: `receive, putaway, map`

---

## Customer (portal)

Persona duy nhất **không phải nhân viên**: khách hàng gửi hàng ở kho, đăng
nhập cổng riêng tại port 8081 (`sentry-wms/portal`), không bao giờ chạm
vào admin panel hay app mobile.

| Khác biệt | Nhân viên | Khách hàng |
|---|---|---|
| Bảng | `users` | `customer_users` |
| Quyền | `role` + `page_keys` + `allowed_functions` | `customer_user_permissions.feature_key` |
| Phiên | cookie `sentry_auth` | cookie `sentry_portal_auth` |
| Phạm vi dữ liệu | theo `warehouse_ids` | theo `customer_id` — chỉ dữ liệu của chính khách |
| Cấp phát | Users | **Portal accounts** (page key `customer-users`) |

### Feature grants

| `feature_key` | Mở gì trên cổng khách |
|---|---|
| `inventory` | Tồn kho của chính khách (theo SKU / lô / hạn dùng, **không** hiện bin/zone) |
| `orders` | Đơn xuất + chi tiết + tạo yêu cầu xuất mới |
| `inbound` | Phiếu nhập đã gán chủ hàng cho khách đó |
| `invoices` | Hóa đơn **đã phát hành** (bản nháp không hiển thị) |
| `reports` | Đã khai báo, chưa có route — cấp cũng chưa mở gì |

Không có cơ chế bypass kiểu ADMIN: tài khoản mới cấp mà chưa gán quyền
nào thì đăng nhập được, đổi mật khẩu được, và không thấy gì khác.

### Token của hệ thống khách (tuỳ chọn)

Nếu ERP của khách gọi API trực tiếp, cấp `X-WMS-Token` với **Customer
binding** trên trang API tokens. Token đó bị bó vào đúng khách: write
inbound bị đóng dấu chủ hàng, `snapshot.inventory` chỉ trả hàng của khách,
còn event feed / dockd / POS bị từ chối. Chi tiết:
[customer-api.md](customer-api.md).

### Checklist cấp tài khoản khách

1. Có `customers` row (Admin → Customers) — đây là chủ sở hữu dữ liệu.
2. Gán chủ hàng cho dữ liệu: **Owner** trên Items, **For customer** trên
   Purchase Orders. Không gán thì cổng khách trống, dù tài khoản đúng.
3. Portal accounts → New → chọn khách, đặt username + mật khẩu tạm, tick
   feature cần mở. Tài khoản mặc định `must_change_password`.
4. Đưa mật khẩu tạm cho khách qua kênh riêng; lần đăng nhập đầu hệ thống
   ép đổi.
5. Thu hồi: **Deactivate** trên Portal accounts cắt phiên đang mở ngay,
   không xoá lịch sử.

---

## Checklist tạo user go-live

1. Tạo warehouse và gán `warehouse_ids` đúng kho pilot.
2. Users → New User → chọn **Apply preset** → chỉnh nếu cần → Save.
3. Đăng nhập bằng user đó, xác nhận sidebar + Home mobile đúng UAT `RM-01`…`RM-03`.
4. Không dùng chung tài khoản Admin cho picker/billing trên thiết bị sàn.

---

## Ma trận nhanh (✓ = có quyền)

| Page / function | Admin | Supervisor | Picker | Billing | Receiver |
|-----------------|:-----:|:----------:|:------:|:-------:|:--------:|
| Dashboard | ✓ | ✓ | ✓ | ✓ | ✓ |
| Inventory | ✓ | ✓ | ✓ | — | ✓ |
| PO / Receive / Putaway (admin) | ✓ | ✓ | — | — | ✓ |
| SO / Pick tickets / Batches | ✓ | ✓ | — | — | — |
| Pallets / Expiry / Gate | ✓ | ✓ | — | — | Pallets+Gate |
| Billing / Invoices | ✓ | — | — | ✓ | — |
| Users / Settings | ✓ | — | — | — | — |
| Mobile Receive | ✓ | ✓ | — | — | ✓ |
| Mobile Put-away | ✓ | ✓ | — | — | ✓ |
| Mobile Pick/Pack/Ship | ✓ | ✓ | ✓ | — | — |
