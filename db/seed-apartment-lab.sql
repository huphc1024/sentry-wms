-- ============================================================
-- SENTRY WMS - Dữ liệu demo Phòng Thử Nghiệm
-- ============================================================
-- Khớp với 61 nhãn mã vạch Zebra in sẵn.
-- Cross-referenced against HANDOFF-SESSION5-CLEAN-SLATE.md
-- ============================================================

-- ============================================================
-- KHO (2)
-- ============================================================
INSERT INTO warehouses (warehouse_code, warehouse_name, address) VALUES
('APT-LAB', 'Phòng Thử Nghiệm', '123 Đường Dev, Denver, CO'),
('VIRTUAL', 'Kho Ảo', 'Không có');

-- ============================================================
-- KHU VỰC (6 khu trong APT-LAB, warehouse_id=1)
-- ============================================================
INSERT INTO zones (warehouse_id, zone_code, zone_name, zone_type) VALUES
(1, 'RCV',   'Khu nhận hàng',        'RECEIVING'),
(1, 'PICK',  'Khu soạn hàng',        'PICKING'),
(1, 'BULK',  'Khu lưu trữ',          'STORAGE'),
(1, 'STAGE', 'Khu staging',          'STAGING'),
(1, 'SHIP',  'Quầy giao hàng',       'SHIPPING'),
(1, 'QC',    'Kiểm tra chất lượng',  'STORAGE');

-- ============================================================
-- VỊ TRÍ KHO (16 vị trí)
-- zone_id mapping: 1=RCV, 2=PICK, 3=BULK, 4=STAGE, 5=SHIP, 6=QC
-- ============================================================
INSERT INTO bins (zone_id, warehouse_id, bin_code, bin_barcode, bin_type, aisle, row_num, level_num, pick_sequence, putaway_sequence, description, external_id) VALUES
-- Nhận hàng (zone 1)
(1, 1, 'RECV-01',  'RECV-01',  'Staging', NULL, NULL, NULL, 0,   0,   'Cửa trước bên trái',  gen_random_uuid()),
(1, 1, 'RECV-02',  'RECV-02',  'Staging', NULL, NULL, NULL, 0,   0,   'Cửa trước bên phải', gen_random_uuid()),
-- Kệ soạn hàng (zone 2) - Kệ A
(2, 1, 'A-01-01',  'A-01-01',  'Pickable', 'A', '01', '01', 100, 100, 'Kệ 1, bên trái',    gen_random_uuid()),
(2, 1, 'A-01-02',  'A-01-02',  'Pickable', 'A', '01', '02', 200, 200, 'Kệ 1, giữa',        gen_random_uuid()),
(2, 1, 'A-01-03',  'A-01-03',  'Pickable', 'A', '01', '03', 300, 300, 'Kệ 1, bên phải',    gen_random_uuid()),
(2, 1, 'A-02-01',  'A-02-01',  'Pickable', 'A', '02', '01', 400, 400, 'Kệ 2, bên phải',    gen_random_uuid()),
(2, 1, 'A-02-02',  'A-02-02',  'Pickable', 'A', '02', '02', 500, 500, 'Kệ 2, giữa',        gen_random_uuid()),
(2, 1, 'A-02-03',  'A-02-03',  'Pickable', 'A', '02', '03', 600, 600, 'Kệ 2, bên trái',    gen_random_uuid()),
-- Kệ soạn hàng (zone 2) - Kệ B
(2, 1, 'B-01-01',  'B-01-01',  'Pickable', 'B', '01', '01', 700, 700, 'Kệ 3, bên trái',    gen_random_uuid()),
(2, 1, 'B-01-02',  'B-01-02',  'Pickable', 'B', '01', '02', 800, 800, 'Kệ 3, giữa',        gen_random_uuid()),
(2, 1, 'B-01-03',  'B-01-03',  'Pickable', 'B', '01', '03', 900, 900, 'Kệ 3, bên phải',    gen_random_uuid()),
-- Lưu trữ (zone 3)
(3, 1, 'BULK-01',  'BULK-01',  'Pickable', NULL, NULL, NULL, 0, 0, 'Tủ / Sàn',            gen_random_uuid()),
(3, 1, 'BULK-02',  'BULK-02',  'Pickable', NULL, NULL, NULL, 0, 0, 'Tủ / Sàn',            gen_random_uuid()),
-- Staging (zone 4)
(4, 1, 'SHIP-01',  'SHIP-01',  'Pickable', NULL, NULL, NULL, 0, 0, 'Bàn, bên trái',       gen_random_uuid()),
(4, 1, 'SHIP-02',  'SHIP-02',  'Pickable', NULL, NULL, NULL, 0, 0, 'Bàn, bên phải',       gen_random_uuid()),
-- QC (zone 6)
(6, 1, 'QC-01',    'QC-01',    'Staging', NULL, NULL, NULL, 0, 0, 'Hộp nhỏ trên bàn',     gen_random_uuid());

-- ============================================================
-- SẢN PHẨM (20 mặt hàng demo)
-- default_bin_id references: RECV-01=1, RECV-02=2, A-01-01=3, A-01-02=4,
--   A-01-03=5, A-02-01=6, A-02-02=7, A-02-03=8, B-01-01=9, B-01-02=10,
--   B-01-03=11, BULK-01=12, BULK-02=13, SHIP-01=14, SHIP-02=15, QC-01=16
-- ============================================================
INSERT INTO items (sku, item_name, description, upc, category, weight_lbs, default_bin_id, external_id) VALUES
('TST-001', 'Ruồi khô Elk Hair (cỡ 14)',           'Mẫu ruồi khô kinh điển',              '100000000001', 'Ruồi giả',    0.01, 3,  gen_random_uuid()),
('TST-002', 'Ruồi Woolly Bugger đen (cỡ 8)',       'Mẫu streamer đa năng',                '100000000002', 'Ruồi giả',    0.01, 4,  gen_random_uuid()),
('TST-003', 'Ruồi khô Adams (cỡ 16)',              'Ruồi khô đa dụng',                    '100000000003', 'Ruồi giả',    0.01, 5,  gen_random_uuid()),
('TST-004', 'Ruồi nymph Pheasant Tail (cỡ 12)',    'Mẫu nymph kinh điển',                 '100000000004', 'Ruồi giả',    0.01, 6,  gen_random_uuid()),
('TST-005', 'Dây câu WF 5wt',                      'Dây câu cao cấp weight-forward',       '100000000005', 'Dây câu',     0.25, 7,  gen_random_uuid()),
('TST-006', 'Giày wading đế nỉ',                   'Giày wading cao cấp đế nỉ',           '100000000006', 'Giày dép',    2.50, 8,  gen_random_uuid()),
('TST-007', 'Leader thuôn 9ft 5X',                 'Leader không nút thuôn dần',          '100000000007', 'Phụ kiện dây',0.02, 9,  gen_random_uuid()),
('TST-008', 'Cần câu 9ft 5wt',                     'Cần câu 4 khúc trọng lượng 5',        '100000000008', 'Cần câu',     3.00, 10, gen_random_uuid()),
('TST-009', 'Hộp đựng ruồi Slim lớn',              'Hộp đựng ruồi chống nước',            '100000000009', 'Phụ kiện',    0.30, 11, gen_random_uuid()),
('TST-010', 'Bộ vá wader UV',                      'Bộ vá wader khô UV',                  '100000000010', 'Sửa chữa',    0.15, 11, gen_random_uuid()),
('TST-011', 'Cần câu trout 4pc 9ft',               'Cần câu 4 khúc trọng lượng 4',        '100000000011', 'Cần câu',     2.80, 3,  gen_random_uuid()),
('TST-012', 'Dây câu WF5F cao cấp',                'Dây câu nổi weight-forward',          '100000000012', 'Dây câu',     0.25, 4,  gen_random_uuid()),
('TST-013', 'Quần wader ngực stockingfoot',        'Quần wader thoáng khí stockingfoot',  '100000000013', 'Quần wader',  3.50, 5,  gen_random_uuid()),
('TST-014', 'Máy câu arbor lớn',                   'Máy câu fly arbor lớn',               '100000000014', 'Máy câu',     0.45, 6,  gen_random_uuid()),
('TST-015', 'Túi sling chống nước',                'Túi đeo chéo chống nước',             '100000000015', 'Túi đeo',     1.20, 7,  gen_random_uuid()),
('TST-016', 'Ruồi nymph Hare''s Ear (cỡ 14)',      'Nymph đầu bi kinh điển',              '100000000016', 'Ruồi giả',    0.01, 8,  gen_random_uuid()),
('TST-017', 'Ruồi Copper John (cỡ 16)',            'Mẫu nymph có trọng lượng',            '100000000017', 'Ruồi giả',    0.01, 9,  gen_random_uuid()),
('TST-018', 'Ruồi khô Parachute Adams (cỡ 18)',    'Ruồi khô dễ nhìn',                    '100000000018', 'Ruồi giả',    0.01, 10, gen_random_uuid()),
('TST-019', 'Ruồi Stimulator cam (cỡ 10)',         'Mẫu ruồi khô thu hút',                '100000000019', 'Ruồi giả',    0.01, 11, gen_random_uuid()),
('TST-020', 'Ruồi San Juan đỏ (cỡ 12)',            'Mẫu giun đơn giản',                   '100000000020', 'Ruồi giả',    0.01, 12, gen_random_uuid());

-- ============================================================
-- TỒN KHO BAN ĐẦU (tất cả sản phẩm trong vị trí mặc định)
-- ============================================================
INSERT INTO inventory (item_id, bin_id, warehouse_id, quantity_on_hand) VALUES
(1,  3,  1, 50),   -- TST-001 in A-01-01
(2,  4,  1, 50),   -- TST-002 in A-01-02
(3,  5,  1, 50),   -- TST-003 in A-01-03
(4,  6,  1, 50),   -- TST-004 in A-02-01
(5,  7,  1, 25),   -- TST-005 in A-02-02
(6,  8,  1, 10),   -- TST-006 in A-02-03
(7,  9,  1, 100),  -- TST-007 in B-01-01
(8,  10, 1, 15),   -- TST-008 in B-01-02
(9,  11, 1, 20),   -- TST-009 in B-01-03
(10, 11, 1, 30),   -- TST-010 in B-01-03 (shared bin)
(11, 3,  1, 12),   -- TST-011 in A-01-01 (shared bin)
(12, 4,  1, 20),   -- TST-012 in A-01-02 (shared bin)
(13, 5,  1, 8),    -- TST-013 in A-01-03 (shared bin)
(14, 6,  1, 10),   -- TST-014 in A-02-01 (shared bin)
(15, 7,  1, 15),   -- TST-015 in A-02-02 (shared bin)
(16, 8,  1, 40),   -- TST-016 in A-02-03 (shared bin)
(17, 9,  1, 60),   -- TST-017 in B-01-01 (shared bin)
(18, 10, 1, 45),   -- TST-018 in B-01-02 (shared bin)
(19, 11, 1, 35),   -- TST-019 in B-01-03 (shared bin)
(20, 12, 1, 200);  -- TST-020 in BULK-01

-- ============================================================
-- NGƯỜI DÙNG
-- ============================================================
-- Admin user is created with an unusable placeholder password_hash. The
-- seed.sh wrapper MUST run immediately after this file and overwrite the
-- hash with a random password (logged to stdout for the operator) before
-- the API is reachable. Running this SQL directly (bypassing seed.sh)
-- leaves the admin account unable to authenticate, which is the safe
-- default. See V-069 in the Phase 6 security audit.
INSERT INTO users (username, password_hash, full_name, role, warehouse_id, allowed_functions, external_id)
VALUES ('admin', 'SEED_SCRIPT_WILL_REPLACE_THIS', 'Quản trị viên', 'ADMIN', 1, '{}', gen_random_uuid());

-- ============================================================
-- CÀI ĐẶT ỨNG DỤNG
-- ============================================================
INSERT INTO app_settings (key, value) VALUES ('session_timeout_hours', '8');
INSERT INTO app_settings (key, value) VALUES ('require_packing_before_shipping', 'true');
INSERT INTO app_settings (key, value) VALUES ('default_receiving_bin', '1');
INSERT INTO app_settings (key, value) VALUES ('allow_over_receiving', 'true');

-- ============================================================
-- ĐƠN MUA HÀNG (5 đơn)
-- ============================================================

-- PO-2026-001: Nhập kho ban đầu lớn, 10 dòng (Nhà cung cấp thử A)
INSERT INTO purchase_orders (po_number, po_barcode, vendor_name, status, expected_date, warehouse_id, created_by, external_id)
VALUES ('PO-2026-001', 'PO-2026-001', 'Nhà cung cấp thử A', 'OPEN', CURRENT_DATE + INTERVAL '3 days', 1, 'admin', gen_random_uuid());
INSERT INTO purchase_order_lines (po_id, item_id, quantity_ordered, line_number) VALUES
(1, 1,  100, 1),
(1, 2,  100, 2),
(1, 3,  100, 3),
(1, 4,  100, 4),
(1, 5,  50,  5),
(1, 6,  20,  6),
(1, 7,  200, 7),
(1, 8,  30,  8),
(1, 9,  40,  9),
(1, 10, 60,  10);

-- PO-2026-002: Đặt lại nhỏ, 3 dòng (Nhà cung cấp thử B)
INSERT INTO purchase_orders (po_number, po_barcode, vendor_name, status, expected_date, warehouse_id, created_by, external_id)
VALUES ('PO-2026-002', 'PO-2026-002', 'Nhà cung cấp thử B', 'OPEN', CURRENT_DATE + INTERVAL '5 days', 1, 'admin', gen_random_uuid());
INSERT INTO purchase_order_lines (po_id, item_id, quantity_ordered, line_number) VALUES
(2, 11, 25, 1),
(2, 12, 25, 2),
(2, 13, 15, 3);

-- PO-2026-003: Trùng mặt hàng với PO-001, 8 dòng (Nhà cung cấp thử A)
INSERT INTO purchase_orders (po_number, po_barcode, vendor_name, status, expected_date, warehouse_id, created_by, external_id)
VALUES ('PO-2026-003', 'PO-2026-003', 'Nhà cung cấp thử A', 'OPEN', CURRENT_DATE + INTERVAL '7 days', 1, 'admin', gen_random_uuid());
INSERT INTO purchase_order_lines (po_id, item_id, quantity_ordered, line_number) VALUES
(3, 1,  50,  1),
(3, 2,  50,  2),
(3, 5,  25,  3),
(3, 14, 20,  4),
(3, 15, 30,  5),
(3, 16, 80,  6),
(3, 17, 100, 7),
(3, 18, 75,  8);

-- PO-2026-004: Chỉ mặt hàng mới, 5 dòng (Nhà cung cấp thử C)
INSERT INTO purchase_orders (po_number, po_barcode, vendor_name, status, expected_date, warehouse_id, created_by, external_id)
VALUES ('PO-2026-004', 'PO-2026-004', 'Nhà cung cấp thử C', 'OPEN', CURRENT_DATE + INTERVAL '10 days', 1, 'admin', gen_random_uuid());
INSERT INTO purchase_order_lines (po_id, item_id, quantity_ordered, line_number) VALUES
(4, 16, 50, 1),
(4, 17, 50, 2),
(4, 18, 50, 3),
(4, 19, 50, 4),
(4, 20, 50, 5);

-- PO-2026-005: Đơn một mặt hàng số lượng lớn (Nhà cung cấp thử B)
INSERT INTO purchase_orders (po_number, po_barcode, vendor_name, status, expected_date, warehouse_id, created_by, external_id)
VALUES ('PO-2026-005', 'PO-2026-005', 'Nhà cung cấp thử B', 'OPEN', CURRENT_DATE + INTERVAL '2 days', 1, 'admin', gen_random_uuid());
INSERT INTO purchase_order_lines (po_id, item_id, quantity_ordered, line_number) VALUES
(5, 20, 100, 1);

-- ============================================================
-- ĐƠN BÁN HÀNG (20 đơn)
-- ============================================================

-- SO-2026-001 đến 005: Đơn một mặt hàng
INSERT INTO sales_orders (so_number, so_barcode, customer_name, status, warehouse_id, ship_method, order_date, created_by, external_id) VALUES
('SO-2026-001', 'SO-2026-001', 'Khách hàng thử 1', 'OPEN', 1, 'GROUND',  NOW(), 'admin', gen_random_uuid()),
('SO-2026-002', 'SO-2026-002', 'Khách hàng thử 2', 'OPEN', 1, 'GROUND',  NOW(), 'admin', gen_random_uuid()),
('SO-2026-003', 'SO-2026-003', 'Khách hàng thử 3', 'OPEN', 1, 'EXPRESS', NOW(), 'admin', gen_random_uuid()),
('SO-2026-004', 'SO-2026-004', 'Khách hàng thử 4', 'OPEN', 1, 'GROUND',  NOW(), 'admin', gen_random_uuid()),
('SO-2026-005', 'SO-2026-005', 'Khách hàng thử 5', 'OPEN', 1, 'EXPRESS', NOW(), 'admin', gen_random_uuid());

INSERT INTO sales_order_lines (so_id, item_id, quantity_ordered, line_number) VALUES
(1, 1, 2, 1),   -- SO-001: 2x Ruồi khô Elk Hair
(2, 5, 1, 1),   -- SO-002: 1x Dây câu
(3, 8, 1, 1),   -- SO-003: 1x Cần câu
(4, 9, 1, 1),   -- SO-004: 1x Hộp đựng ruồi
(5, 20, 5, 1);  -- SO-005: 5x Ruồi San Juan

-- SO-2026-006 đến 010: Đơn nhiều mặt hàng
INSERT INTO sales_orders (so_number, so_barcode, customer_name, status, warehouse_id, ship_method, order_date, created_by, external_id) VALUES
('SO-2026-006', 'SO-2026-006', 'Khách hàng thử 1', 'OPEN', 1, 'GROUND',  NOW(), 'admin', gen_random_uuid()),
('SO-2026-007', 'SO-2026-007', 'Khách hàng thử 2', 'OPEN', 1, 'EXPRESS', NOW(), 'admin', gen_random_uuid()),
('SO-2026-008', 'SO-2026-008', 'Khách hàng thử 3', 'OPEN', 1, 'GROUND',  NOW(), 'admin', gen_random_uuid()),
('SO-2026-009', 'SO-2026-009', 'Khách hàng thử 4', 'OPEN', 1, 'EXPRESS', NOW(), 'admin', gen_random_uuid()),
('SO-2026-010', 'SO-2026-010', 'Khách hàng thử 5', 'OPEN', 1, 'GROUND',  NOW(), 'admin', gen_random_uuid());

INSERT INTO sales_order_lines (so_id, item_id, quantity_ordered, line_number) VALUES
-- SO-006: 3 dòng
(6, 1, 3, 1),   (6, 2, 2, 2),   (6, 3, 1, 3),
-- SO-007: 4 dòng
(7, 4, 2, 1),   (7, 5, 1, 2),   (7, 6, 1, 3),   (7, 7, 5, 4),
-- SO-008: 5 dòng
(8, 8, 1, 1),   (8, 9, 2, 2),   (8, 10, 3, 3),  (8, 11, 1, 4),  (8, 12, 2, 5),
-- SO-009: 3 dòng
(9, 13, 1, 1),  (9, 14, 1, 2),  (9, 15, 1, 3),
-- SO-010: 4 dòng
(10, 16, 5, 1), (10, 17, 5, 2), (10, 18, 5, 3), (10, 19, 5, 4);

-- SO-2026-011 đến 015: Mặt hàng trùng (cùng mặt hàng trên nhiều SO để test tranh chấp)
INSERT INTO sales_orders (so_number, so_barcode, customer_name, status, warehouse_id, ship_method, order_date, created_by, external_id) VALUES
('SO-2026-011', 'SO-2026-011', 'Khách hàng thử 1', 'OPEN', 1, 'GROUND',  NOW(), 'admin', gen_random_uuid()),
('SO-2026-012', 'SO-2026-012', 'Khách hàng thử 2', 'OPEN', 1, 'GROUND',  NOW(), 'admin', gen_random_uuid()),
('SO-2026-013', 'SO-2026-013', 'Khách hàng thử 3', 'OPEN', 1, 'EXPRESS', NOW(), 'admin', gen_random_uuid()),
('SO-2026-014', 'SO-2026-014', 'Khách hàng thử 4', 'OPEN', 1, 'GROUND',  NOW(), 'admin', gen_random_uuid()),
('SO-2026-015', 'SO-2026-015', 'Khách hàng thử 5', 'OPEN', 1, 'EXPRESS', NOW(), 'admin', gen_random_uuid());

INSERT INTO sales_order_lines (so_id, item_id, quantity_ordered, line_number) VALUES
-- Cả 5 SO đều muốn cùng mặt hàng hot
(11, 1, 2, 1),  (11, 7, 3, 2),
(12, 1, 2, 1),  (12, 7, 3, 2),
(13, 1, 2, 1),  (13, 7, 3, 2),
(14, 1, 2, 1),  (14, 7, 3, 2),
(15, 1, 2, 1),  (15, 7, 3, 2);

-- SO-2026-016 đến 018: Lộ trình serpentine (mặt hàng rải khắp các lối đi)
INSERT INTO sales_orders (so_number, so_barcode, customer_name, status, warehouse_id, ship_method, order_date, created_by, external_id) VALUES
('SO-2026-016', 'SO-2026-016', 'Khách hàng thử 1', 'OPEN', 1, 'GROUND',  NOW(), 'admin', gen_random_uuid()),
('SO-2026-017', 'SO-2026-017', 'Khách hàng thử 2', 'OPEN', 1, 'EXPRESS', NOW(), 'admin', gen_random_uuid()),
('SO-2026-018', 'SO-2026-018', 'Khách hàng thử 3', 'OPEN', 1, 'GROUND',  NOW(), 'admin', gen_random_uuid());

INSERT INTO sales_order_lines (so_id, item_id, quantity_ordered, line_number) VALUES
-- SO-016: hits A-01-01, A-02-01, B-01-01, B-01-03
(16, 1, 1, 1),  (16, 4, 1, 2),  (16, 17, 1, 3), (16, 19, 1, 4),
-- SO-017: hits A-01-02, A-02-02, B-01-02, BULK-01
(17, 2, 1, 1),  (17, 5, 1, 2),  (17, 18, 1, 3), (17, 20, 2, 4),
-- SO-018: hits A-01-03, A-02-03, B-01-01, B-01-03
(18, 3, 1, 1),  (18, 6, 1, 2),  (18, 7, 1, 3),  (18, 9, 1, 4);

-- SO-2026-019 đến 020: Test soạn thiếu (đặt nhiều hơn tồn kho)
INSERT INTO sales_orders (so_number, so_barcode, customer_name, status, warehouse_id, ship_method, order_date, created_by, external_id) VALUES
('SO-2026-019', 'SO-2026-019', 'Khách hàng thử 4', 'OPEN', 1, 'GROUND', NOW(), 'admin', gen_random_uuid()),
('SO-2026-020', 'SO-2026-020', 'Khách hàng thử 5', 'OPEN', 1, 'GROUND', NOW(), 'admin', gen_random_uuid());

INSERT INTO sales_order_lines (so_id, item_id, quantity_ordered, line_number) VALUES
-- SO-019: muốn 99 nhưng chỉ còn 10 (TST-006 giày wading)
(19, 6, 99, 1),
-- SO-020: muốn 999 nhưng chỉ còn 200 (TST-020 Ruồi San Juan)
(20, 20, 999, 1);
