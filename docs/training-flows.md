# Training — 4 flow chính (go-live)

Đối tượng: nhân viên kho pilot. Mỗi flow ~15–30 phút hands-on.
Chi tiết quyền: [role-matrix.md](role-matrix.md). Checklist kiểm thử: [uat-test-cases.md](uat-test-cases.md).

---

## Flow 1 — Nhận hàng (Receive)

**Ai:** Receiver / Supervisor · **Thiết bị:** Mobile

1. (Tuỳ chọn) **Gate** — check-in xe INBOUND: biển số + PO.  
2. Home → **RECEIVE** → scan barcode PO.  
3. Chọn / tạo **pallet** (3PL): scan QR pallet hoặc tạo mã mới.  
4. Scan SKU/UPC từng kiện; nhập qty (hoặc Turbo scan liên tục).  
5. Nhập **lot / HSD** nếu hàng có hạn.  
6. Xác nhận đủ lines → PO chuyển **RECEIVED**.

**Admin hỗ trợ:** Purchase Orders (tạo/sửa PO), Receiving dashboard, Vehicle Movements.

**Lỗi thường gặp:** SKU không thuộc PO; quên gắn pallet; rời màn hình khi còn batch pending.

---

## Flow 2 — Cất hàng (Put-away)

**Ai:** Receiver / Supervisor · **Thiết bị:** Mobile

1. Home → **PUT-AWAY**.  
2. Scan hàng / pallet đang ở bin staging.  
3. Làm theo gợi ý bin (nếu có) → **scan bin đích**.  
4. Nếu tồn gắn pallet: **scan đúng QR pallet** trước khi confirm.  
5. Kiểm tra Simulation / Inventory: SKU đã ở đúng vị trí.

**Admin hỗ trợ:** Put-away staging, Pallets, Warehouse Simulation.

**Lỗi thường gặp:** Sai pallet; thiếu `pallet_code`; cất nhầm warehouse.

---

## Flow 3 — Pick (FEFO) → Pack → Ship

**Ai:** Picker · **Thiết bị:** Mobile (+ Admin tickets nếu in phiếu)

1. Admin (supervisor): đảm bảo SO **OPEN**, tồn đủ, (tuỳ) in **Picking Tickets**.  
2. Mobile → **PICK** → nhận batch / walk.  
3. Tại mỗi task: đi đúng bin → **scan pallet QR** (nếu task có pallet) → scan SKU → confirm qty.  
4. Hệ thống ưu tiên **HSD sớm (FEFO)** — không tự chọn pallet “gần hơn” nếu khác task.  
5. **PACK** — verify từng món.  
6. **SHIP** — carrier/tracking hoặc local pickup.  
7. (Tuỳ) Gate OUTBOUND gắn SO đã được đóng khi ship.

**Admin hỗ trợ:** Sales Orders, Picking Batches (nhả batch kẹt), Backorders.

**Lỗi thường gặp:** `Sai pallet — cần …`; short pick chưa xác nhận; batch kẹt cần release.

---

## Flow 4 — Billing 3PL

**Ai:** Billing clerk · **Thiết bị:** Admin web

1. **Customers** — tạo/khách; gắn contract + `billing_cycle`.  
2. **Rate cards** — STORAGE / HANDLING / PICK theo kho.  
3. Vận hành ngày: nhận/cất/pick/xe tạo `billing_events` tự động; Celery **daily storage**.  
4. **Invoices** → Generate cycle theo hợp đồng → xem dòng → **PDF** → đánh dấu SENT.  
5. Đối soát unbilled trên Customers nếu cần.

**Lỗi thường gặp:** Beat tắt → không có STORAGE/ngày; pallet không gắn customer; trùng event (đã có unique — báo lỗi thay vì double charge).

---

## Buổi training mẫu (½ ngày)

| Slot | Nội dung |
|------|----------|
| 0:00 | Login admin/mobile, persona, warehouse scope |
| 0:30 | Flow 1 Receive + Gate |
| 1:15 | Flow 2 Put-away + Simulation |
| 2:00 | Flow 3 Pick FEFO + Pack/Ship |
| 2:45 | Flow 4 Billing + PDF |
| 3:15 | Chạy nhanh UAT R-01, PA-01, PK-03, BL-02 |
| 3:45 | Q&A + sign-off training |

---

## Tài liệu thêm

- Runbook ops: [runbooks/go-live.md](runbooks/go-live.md)
- Patterns kỹ thuật: [patterns.md](patterns.md)
