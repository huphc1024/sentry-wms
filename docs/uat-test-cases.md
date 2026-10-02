# UAT — Go-live 1 kho (Phase 6)

Checklist xác nhận chấp nhận (UAT) trước khi ký go-live production.
Mỗi case: **Pass / Fail / N/A**, ghi người test, ngày, ghi chú.

Môi trường khuyến nghị: kho pilot có seed/demo data hoặc data thật đã migrate 078–086.

---

## Sign-off

| Mục | Giá trị |
|-----|---------|
| Kho / warehouse_code | |
| Phiên bản API / admin / mobile | |
| Ngày UAT | |
| Tester | |
| Supervisor ký | |
| Kết quả tổng | ☐ Pass ☐ Pass có điều kiện ☐ Fail |

**Điều kiện Pass:** mọi case **Must** = Pass; case **Should** Fail phải có workaround ghi trong cột ghi chú.

---

## Quy ước

- **Must** — bắt buộc trước go-live.
- **Should** — nên pass; Fail được chấp nhận nếu có workaround + ticket.
- Mã lỗi UI/API ghi đúng chuỗi người dùng thấy (vd. `Sai pallet — cần PLT-…`).

---

## A. Inbound — Receive (R-01 → R-08)

| ID | Mức | Tình huống | Bước | Kỳ vọng |
|----|-----|------------|------|---------|
| R-01 | Must | Scan PO hợp lệ | Mobile Receive → scan `po_barcode` / PO number OPEN | Mở phiên nhận; hiện line items |
| R-02 | Must | Scan SKU thuộc PO | Scan UPC/SKU trên PO | Cộng qty received; không lỗi |
| R-03 | Must | SKU không thuộc PO | Scan SKU lạ | Từ chối; thông báo rõ (SKU không thuộc PO) |
| R-04 | Must | Over-receive | Nhận vượt `qty_ordered` (nếu policy chặn) | Cảnh báo / block theo settings |
| R-05 | Must | Gán pallet khi nhận (3PL) | Tạo/scan `pallet_code`, nhập lot/HSD nếu có | Receipt gắn pallet; pallet status phù hợp |
| R-06 | Must | Turbo / batch receive | Scan liên tục nhiều dòng | Optimistic count; flush batch; drain trước khi đổi PO |
| R-07 | Must | Hủy / undo receipt | Cancel receipt vừa tạo (cùng PO) | Qty rollback; không đụng PO khác |
| R-08 | Must | PO → RECEIVED | Nhận đủ lines | PO `RECEIVED`; gate session INBOUND (nếu có) đóng; event `inbound.completed` (nếu webhook bật) |

---

## B. Put-away

| ID | Mức | Tình huống | Bước | Kỳ vọng |
|----|-----|------------|------|---------|
| PA-01 | Must | Cất từ staging | Put-Away → scan item/pallet staging → scan bin đích | Inventory chuyển bin; ledger/audit có bản ghi |
| PA-02 | Must | Sai pallet | Scan pallet khác với tồn staging | Từ chối (`Scanned pallet does not match…` hoặc tương đương) |
| PA-03 | Must | Thiếu pallet_code khi tồn pallet | Confirm putaway không scan pallet | 400 / yêu cầu `pallet_code` |
| PA-04 | Should | Suggest bin | Mở gợi ý preferred bin | Gợi ý đúng warehouse/zone |

---

## C. Outbound — Pick / Pack / Ship

| ID | Mức | Tình huống | Bước | Kỳ vọng |
|----|-----|------------|------|---------|
| PK-01 | Must | Tạo batch pick | Mobile Pick / admin batch | Task list theo walk path |
| PK-02 | Must | FEFO | 2 pallet cùng SKU khác HSD | Task ưu tiên HSD sớm hơn |
| PK-03 | Must | Scan pallet QR | Trước confirm pick có `pallet_code` | Sai mã → `Sai pallet — cần …` |
| PK-04 | Must | Confirm pick đúng SKU/qty | Scan item + qty | Task COMPLETE; allocation giảm |
| PK-05 | Must | Pack | Pack screen verify | SO → PACKED |
| PK-06 | Must | Ship | Nhập carrier/tracking (hoặc local pickup) | SO → SHIPPED; event `outbound.shipped`; đóng gate OUTBOUND nếu có |
| PK-07 | Should | Short pick | Đánh SHORT khi thiếu hàng | Không ship thiếu nếu chưa xác nhận short |

---

## D. Offline / hàng đợi scan (receive)

| ID | Mức | Tình huống | Bước | Kỳ vọng |
|----|-----|------------|------|---------|
| OF-01 | Must | Mất mạng giữa batch | Turbo receive → ngắt mạng khi còn pending | Pending không mất; lỗi hiện rõ; sau online drain/refetch |
| OF-02 | Must | Đôi scan cùng SKU | Scan nhanh liên tiếp | Queue tuần tự; tổng qty khớp server sau flush |
| OF-03 | Should | Rời màn hình còn queue | Back khi còn buffered scans | Drain trước khi unmount (không mất scan) |

> App không có chế độ offline đầy đủ lâu dài; OF-* kiểm tra **hàng đợi scan / batch flush** (turbo receive), không phải sync offline nhiều giờ.

---

## E. Expiry & billing (smoke)

| ID | Mức | Tình huống | Bước | Kỳ vọng |
|----|-----|------------|------|---------|
| EX-01 | Should | Hàng hết hạn | Chạy `daily_expiry_scan` (beat hoặc manual) | Inventory → quarantine; event `expiry.expired` |
| EX-02 | Should | Admin dispose / extend | Expiry page bulk action | Cập nhật HSD hoặc dispose + billing nếu cấu hình |
| BL-01 | Must | Storage billing | `daily_storage_billing` cho ngày có pallet tồn | `billing_events` STORAGE không trùng (unique service_date) |
| BL-02 | Must | Lập hóa đơn chu kỳ | Admin Invoices → generate cycle | Invoice + PDF; event `invoice.issued` khi SENT |

---

## F. Gate & quyền

| ID | Mức | Tình huống | Bước | Kỳ vọng |
|----|-----|------------|------|---------|
| GT-01 | Must | Check-in INBOUND | Gate: biển số + PO | Session OPEN; hiện trên Vehicle Movements |
| GT-02 | Must | Check-in OUTBOUND | Biển số + SO | Session OPEN gắn SO |
| RM-01 | Must | Role picker | User preset Picker đăng nhập admin | Không thấy Billing / Users / Settings |
| RM-02 | Must | Role billing clerk | Chỉ `billing` (+ dashboard) | Không sửa Users; thấy Customers/Invoices |
| RM-03 | Must | Role supervisor | Preset Supervisor | Thấy inbound/outbound/expiry/pallets; không bắt buộc Settings hệ thống |

---

## G. Simulation / map

| ID | Mức | Tình huống | Bước | Kỳ vọng |
|----|-----|------------|------|---------|
| SM-01 | Must | SKU search | Simulation tìm SKU có tồn | Trỏ đúng rack/pallet/bin |
| SM-02 | Should | Badge HSD | Pallet sắp hết hạn ≤30 ngày | Có cảnh báo trên simulation |

---

## Kết thúc UAT

- [ ] Đính kèm ảnh/PDF lỗi Fail (nếu có)
- [ ] Ticket follow-up liệt kê trong phần ghi chú
- [ ] Runbook go-live đã đọc: [runbooks/go-live.md](runbooks/go-live.md)
- [ ] Role matrix đã áp dụng user thật: [role-matrix.md](role-matrix.md)
