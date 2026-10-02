-- Cập nhật dữ liệu demo hiện có sang tiếng Việt (chạy trên DB đã seed trước đó)

-- Kho
UPDATE warehouses SET warehouse_name = 'Phòng Thử Nghiệm', address = '123 Đường Dev, Denver, CO' WHERE warehouse_code = 'APT-LAB';
UPDATE warehouses SET warehouse_name = 'Kho Ảo', address = 'Không có' WHERE warehouse_code = 'VIRTUAL';
UPDATE warehouses SET warehouse_name = 'Kho của tôi' WHERE warehouse_code = 'WH-01';

-- Khu vực
UPDATE zones SET zone_name = 'Khu nhận hàng' WHERE zone_code = 'RCV' AND zone_name = 'Receiving Area';
UPDATE zones SET zone_name = 'Khu soạn hàng' WHERE zone_code = 'PICK' AND zone_name = 'Pick Zone';
UPDATE zones SET zone_name = 'Khu lưu trữ' WHERE zone_code = 'BULK' AND zone_name = 'Bulk Storage';
UPDATE zones SET zone_name = 'Khu staging' WHERE zone_code = 'STAGE' AND zone_name = 'Staging Area';
UPDATE zones SET zone_name = 'Quầy giao hàng' WHERE zone_code = 'SHIP' AND zone_name = 'Shipping Desk';
UPDATE zones SET zone_name = 'Kiểm tra chất lượng' WHERE zone_code = 'QC' AND zone_name = 'Quality Control';
UPDATE zones SET zone_name = 'Nhận hàng' WHERE zone_code = 'RCV' AND zone_name = 'Receiving';
UPDATE zones SET zone_name = 'Soạn hàng' WHERE zone_code = 'PICK' AND zone_name = 'Picking';

-- Vị trí kho
UPDATE bins SET description = 'Cửa trước bên trái' WHERE bin_code = 'RECV-01' AND description = 'Front Door Left';
UPDATE bins SET description = 'Cửa trước bên phải' WHERE bin_code = 'RECV-02' AND description = 'Front Door Right';
UPDATE bins SET description = 'Kệ 1, bên trái' WHERE bin_code = 'A-01-01' AND description = 'Shelf 1, Left';
UPDATE bins SET description = 'Kệ 1, giữa' WHERE bin_code = 'A-01-02' AND description = 'Shelf 1, Center';
UPDATE bins SET description = 'Kệ 1, bên phải' WHERE bin_code = 'A-01-03' AND description = 'Shelf 1, Right';
UPDATE bins SET description = 'Kệ 2, bên phải' WHERE bin_code = 'A-02-01' AND description = 'Shelf 2, Right';
UPDATE bins SET description = 'Kệ 2, giữa' WHERE bin_code = 'A-02-02' AND description = 'Shelf 2, Center';
UPDATE bins SET description = 'Kệ 2, bên trái' WHERE bin_code = 'A-02-03' AND description = 'Shelf 2, Left';
UPDATE bins SET description = 'Kệ 3, bên trái' WHERE bin_code = 'B-01-01' AND description = 'Shelf 3, Left';
UPDATE bins SET description = 'Kệ 3, giữa' WHERE bin_code = 'B-01-02' AND description = 'Shelf 3, Center';
UPDATE bins SET description = 'Kệ 3, bên phải' WHERE bin_code = 'B-01-03' AND description = 'Shelf 3, Right';
UPDATE bins SET description = 'Tủ / Sàn' WHERE bin_code IN ('BULK-01', 'BULK-02') AND description = 'Closet / Floor';
UPDATE bins SET description = 'Bàn, bên trái' WHERE bin_code = 'SHIP-01' AND description = 'Desk, Left';
UPDATE bins SET description = 'Bàn, bên phải' WHERE bin_code = 'SHIP-02' AND description = 'Desk, Right';
UPDATE bins SET description = 'Hộp nhỏ trên bàn' WHERE bin_code = 'QC-01' AND description = 'Small Box on Desk';
UPDATE bins SET description = 'Vị trí nhận hàng mặc định' WHERE bin_code = 'RECV-01' AND description = 'Default receiving bin';
UPDATE bins SET description = 'Vị trí soạn hàng mặc định' WHERE bin_code = 'PICK-01' AND description = 'Default pick bin';
UPDATE bins SET description = 'Vị trí lưu trữ mặc định' WHERE bin_code = 'BULK-01' AND description = 'Default bulk bin';

-- Sản phẩm
UPDATE items SET item_name = 'Ruồi khô Elk Hair (cỡ 14)', description = 'Mẫu ruồi khô kinh điển', category = 'Ruồi giả' WHERE sku = 'TST-001';
UPDATE items SET item_name = 'Ruồi Woolly Bugger đen (cỡ 8)', description = 'Mẫu streamer đa năng', category = 'Ruồi giả' WHERE sku = 'TST-002';
UPDATE items SET item_name = 'Ruồi khô Adams (cỡ 16)', description = 'Ruồi khô đa dụng', category = 'Ruồi giả' WHERE sku = 'TST-003';
UPDATE items SET item_name = 'Ruồi nymph Pheasant Tail (cỡ 12)', description = 'Mẫu nymph kinh điển', category = 'Ruồi giả' WHERE sku = 'TST-004';
UPDATE items SET item_name = 'Dây câu WF 5wt', description = 'Dây câu cao cấp weight-forward', category = 'Dây câu' WHERE sku = 'TST-005';
UPDATE items SET item_name = 'Giày wading đế nỉ', description = 'Giày wading cao cấp đế nỉ', category = 'Giày dép' WHERE sku = 'TST-006';
UPDATE items SET item_name = 'Leader thuôn 9ft 5X', description = 'Leader không nút thuôn dần', category = 'Phụ kiện dây' WHERE sku = 'TST-007';
UPDATE items SET item_name = 'Cần câu 9ft 5wt', description = 'Cần câu 4 khúc trọng lượng 5', category = 'Cần câu' WHERE sku = 'TST-008';
UPDATE items SET item_name = 'Hộp đựng ruồi Slim lớn', description = 'Hộp đựng ruồi chống nước', category = 'Phụ kiện' WHERE sku = 'TST-009';
UPDATE items SET item_name = 'Bộ vá wader UV', description = 'Bộ vá wader khô UV', category = 'Sửa chữa' WHERE sku = 'TST-010';
UPDATE items SET item_name = 'Cần câu trout 4pc 9ft', description = 'Cần câu 4 khúc trọng lượng 4', category = 'Cần câu' WHERE sku = 'TST-011';
UPDATE items SET item_name = 'Dây câu WF5F cao cấp', description = 'Dây câu nổi weight-forward', category = 'Dây câu' WHERE sku = 'TST-012';
UPDATE items SET item_name = 'Quần wader ngực stockingfoot', description = 'Quần wader thoáng khí stockingfoot', category = 'Quần wader' WHERE sku = 'TST-013';
UPDATE items SET item_name = 'Máy câu arbor lớn', description = 'Máy câu fly arbor lớn', category = 'Máy câu' WHERE sku = 'TST-014';
UPDATE items SET item_name = 'Túi sling chống nước', description = 'Túi đeo chéo chống nước', category = 'Túi đeo' WHERE sku = 'TST-015';
UPDATE items SET item_name = 'Ruồi nymph Hare''s Ear (cỡ 14)', description = 'Nymph đầu bi kinh điển', category = 'Ruồi giả' WHERE sku = 'TST-016';
UPDATE items SET item_name = 'Ruồi Copper John (cỡ 16)', description = 'Mẫu nymph có trọng lượng', category = 'Ruồi giả' WHERE sku = 'TST-017';
UPDATE items SET item_name = 'Ruồi khô Parachute Adams (cỡ 18)', description = 'Ruồi khô dễ nhìn', category = 'Ruồi giả' WHERE sku = 'TST-018';
UPDATE items SET item_name = 'Ruồi Stimulator cam (cỡ 10)', description = 'Mẫu ruồi khô thu hút', category = 'Ruồi giả' WHERE sku = 'TST-019';
UPDATE items SET item_name = 'Ruồi San Juan đỏ (cỡ 12)', description = 'Mẫu giun đơn giản', category = 'Ruồi giả' WHERE sku = 'TST-020';

-- Người dùng
UPDATE users SET full_name = 'Quản trị viên' WHERE username = 'admin' AND full_name = 'Admin User';

-- Nhà cung cấp
UPDATE purchase_orders SET vendor_name = 'Nhà cung cấp thử A' WHERE vendor_name = 'Test Vendor A';
UPDATE purchase_orders SET vendor_name = 'Nhà cung cấp thử B' WHERE vendor_name = 'Test Vendor B';
UPDATE purchase_orders SET vendor_name = 'Nhà cung cấp thử C' WHERE vendor_name = 'Test Vendor C';

-- Khách hàng
UPDATE sales_orders SET customer_name = 'Khách hàng thử 1' WHERE customer_name = 'Test Customer 1';
UPDATE sales_orders SET customer_name = 'Khách hàng thử 2' WHERE customer_name = 'Test Customer 2';
UPDATE sales_orders SET customer_name = 'Khách hàng thử 3' WHERE customer_name = 'Test Customer 3';
UPDATE sales_orders SET customer_name = 'Khách hàng thử 4' WHERE customer_name = 'Test Customer 4';
UPDATE sales_orders SET customer_name = 'Khách hàng thử 5' WHERE customer_name = 'Test Customer 5';
