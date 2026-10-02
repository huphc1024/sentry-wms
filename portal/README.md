# Cổng khách hàng (Customer Portal)

Vite + React SPA cho khách hàng 3PL, tách hoàn toàn khỏi `admin/`.

Tách workspace là quyết định về bảo mật, không phải về tổ chức mã: `admin/`
có ~48 trang và một sidebar dựng theo `page_keys`, nên mỗi trang mới thêm
vào đó lại là một chỗ có thể rò dữ liệu chéo giữa các khách. Ở đây "khách
không thấy gì khác ngoài dữ liệu của mình" là mặc định kiến trúc: bundle này
chỉ gọi `/api/portal/*`, và mọi endpoint đó đã bị bó bởi
`customer_scope_clause` phía server.

## Chạy dev

```bash
npm install
npm run dev          # http://localhost:4100, proxy /api -> 127.0.0.1:5000
```

Đổi upstream API bằng `VITE_API_PROXY` (ví dụ `http://api:5000` khi chạy
trong container).

## Build / triển khai

```bash
npm run build        # -> dist/
docker compose up -d portal   # nginx phục vụ dist/ ở host port 8081
```

## Phiên đăng nhập

Portal dùng cookie riêng (`sentry_portal_auth` HttpOnly +
`sentry_portal_csrf` double-submit), tên khác với cookie của admin, nên
một nhân viên có thể mở admin và portal trong cùng trình duyệt mà không
phiên nào đè phiên nào.

Điều hướng hiển thị theo `features` mà `GET /api/portal/auth/me` trả về
(`inventory`, `orders`, `inbound`, `invoices`). Ẩn menu chỉ là tiện dụng —
server vẫn trả 403 cho mọi request thiếu grant.
