# HANDOFF

Production Worker và Cloudflare Access đã hoạt động.

## Đã xác minh

- `giaohang.meta.shopping`: live.
- D1 binding: PASS.
- Cloudflare Access: All traffic, email domain `@meta.vn`.
- `ngochai@meta.vn`: Admin/Dispatcher live.
- Backend RBAC và read-only Viewer UI đã deploy.
- D1 đang có 0 đơn trước import.

## Bước kế tiếp

1. Đăng nhập bằng một tài khoản Admin/Dispatcher.
2. Tab **Nạp dữ liệu** → chọn workbook vận hành ngày 2026-10-07 → **Nạp vào D1**.
3. Kiểm kết quả import phải phản ánh đúng số đơn/driver/data-quality.
4. Chạy **Gợi ý phân bổ**.
5. Kiểm **Kết quả phân đơn** theo nhân sự → chuyến → stop → order → COD.
6. Chạy production acceptance và pilot rehearsal.

Không commit workbook hoặc dữ liệu khách hàng vào GitHub.
